/**
 * The engine's safe pattern dialect (IMP-06@PoC FR 3; business rule «усі шаблони — через безпечний рушій регулярних
 * виразів з лімітами довжини і часу»). A recipe is data from the user: its patterns never reach `RegExp` or `eval`.
 * They are parsed here, refused outside the dialect, and run by a Pike VM — a matcher whose time is linear in
 * (program size × text length), so no pattern backtracks. Text is cut before matching (FR 3's table); the program is
 * at most 200 characters with every repeat ≤ 100 copies, so one match is bounded.
 *
 * Dialect: literals; escapes `\d \D \w \W \s \S \b \B \t \n \r \f \v \xHH \uHHHH` and an escaped non-alphanumeric
 * character; classes `[…]`, `[^…]` with ranges; `.`, `^`, `$`; groups `(…)` and `(?:…)`; alternation; repeats `* + ?
 * {n} {n,} {n,m}` (lazy with `?`), the upper bound ≤ 100. Refused: back-references, look-ahead and look-behind, Unicode
 * classes (`\p`, `\P`), more than 3 unbounded repeats, a repeat inside a repeated group, and a pattern whose
 * expanded program costs more than `maxProgramCost` per character («too-complex»: the time limit; the worst allowed
 * pattern takes ≈ 0.27 s on 2 000 characters). Matching ignores case; `^`
 * and `$` are the text's start and end.
 */
export const PATTERN_LIMITS = {
  /** Characters (code points) of a pattern. */
  maxLength: 200,
  /** The upper bound of a repeat. */
  maxRepeat: 100,
  /** Unbounded repeats (`*`, `+`, `{n,}`). */
  maxUnbounded: 3,
  /** Characters of text matched, by the pattern's unbounded repeats: 0, 1, 2, 3. */
  inputChars: [2000, 2000, 400, 120] as const,
  /**
   * The compiled program's work per character of text: an instruction is 1, a class 1 + its items, a
   * group's mark 1 + an eighth of the marks every thread copies. Repeats are expanded («(?:…){100}» is 100 copies), so
   * 200 characters can compile to tens of thousands of instructions: past this the pattern is refused.
   */
  maxProgramCost: 4000,
} as const;

export type PatternIssue =
  | "too-long"
  | "syntax"
  | "backreference"
  | "lookaround"
  | "unicode-class"
  | "nested-repeat"
  | "repeat-bound"
  | "too-many-unbounded"
  | "too-complex";

export interface SafePattern {
  readonly source: string;
  /** Capturing groups (group 0 is the whole match). */
  readonly groups: number;
  readonly unbounded: number;
  /** The first match in the (cut) text: the whole match and each group, null for a group that took no part. */
  match(text: string): (string | null)[] | null;
}

export type CompiledPattern =
  { readonly ok: true; readonly pattern: SafePattern } | { readonly ok: false; readonly issue: PatternIssue };

type ClassItem = readonly [string, string] | "d" | "D" | "w" | "W" | "s" | "S";
type Node =
  | { readonly k: "char"; readonly c: string }
  | { readonly k: "any" }
  | { readonly k: "class"; readonly neg: boolean; readonly items: readonly ClassItem[] }
  | { readonly k: "assert"; readonly a: "bol" | "eol" | "wb" | "nwb" }
  | { readonly k: "seq"; readonly items: readonly Node[] }
  | { readonly k: "alt"; readonly items: readonly Node[] }
  | { readonly k: "group"; readonly index: number | null; readonly body: Node }
  | {
      readonly k: "rep";
      readonly body: Node;
      readonly min: number;
      readonly max: number | null;
      readonly lazy: boolean;
    };

type Escape =
  | { readonly kind: "char"; readonly c: string }
  | { readonly kind: "class"; readonly item: ClassItem }
  | { readonly kind: "assert"; readonly a: "wb" | "nwb" };

class Refused extends Error {
  readonly issue: PatternIssue;
  constructor(issue: PatternIssue) {
    super(issue);
    this.issue = issue;
  }
}

const HEX = /^[0-9a-fA-F]$/;
const DIGIT = /^[0-9]$/;
const ALNUM = /^[0-9A-Za-z]$/;
const CONTROL_ESCAPES: Readonly<Record<string, string>> = { t: "\t", n: "\n", r: "\r", f: "\f", v: "\v" };

class Parser {
  private pos = 0;
  groups = 0;
  unbounded = 0;

  private readonly chars: readonly string[];

  constructor(chars: readonly string[]) {
    this.chars = chars;
  }

  parse(): Node {
    const node = this.alternation();
    if (this.pos < this.chars.length) throw new Refused("syntax"); // a stray «)»
    return node;
  }

  private peek(): string | undefined {
    return this.chars[this.pos];
  }

  private next(): string {
    const c = this.chars[this.pos++];
    if (c === undefined) throw new Refused("syntax");
    return c;
  }

  private alternation(): Node {
    const items = [this.sequence()];
    while (this.peek() === "|") {
      this.pos++;
      items.push(this.sequence());
    }
    return items.length === 1 ? items[0]! : { k: "alt", items };
  }

  private sequence(): Node {
    const items: Node[] = [];
    for (let c = this.peek(); c !== undefined && c !== "|" && c !== ")"; c = this.peek()) {
      const atom = this.atom();
      items.push(this.repeat(atom));
    }
    return { k: "seq", items };
  }

  private atom(): Node {
    const c = this.next();
    switch (c) {
      case "^":
        return { k: "assert", a: "bol" };
      case "$":
        return { k: "assert", a: "eol" };
      case ".":
        return { k: "any" };
      case "[":
        return this.charClass();
      case "(":
        return this.group();
      case "\\":
        return this.escape();
      case "*":
      case "+":
      case "?":
      case "{":
      case "}":
      case "]":
        throw new Refused("syntax");
      default:
        return { k: "char", c };
    }
  }

  private group(): Node {
    let index: number | null = null;
    if (this.peek() === "?") {
      this.pos++;
      const kind = this.next();
      if (kind === "=" || kind === "!") throw new Refused("lookaround");
      if (kind === "<" && (this.peek() === "=" || this.peek() === "!")) throw new Refused("lookaround");
      if (kind !== ":") throw new Refused("syntax");
    } else index = ++this.groups;
    const body = this.alternation();
    if (this.next() !== ")") throw new Refused("syntax");
    return { k: "group", index, body };
  }

  /** One escaped character, a class shorthand or a word boundary, after «\». */
  private escaped(inClass: boolean): Escape {
    const c = this.next();
    if (DIGIT.test(c) && c !== "0") throw new Refused("backreference");
    if (c === "k") throw new Refused("backreference");
    if (c === "p" || c === "P") throw new Refused("unicode-class");
    if ("dDwWsS".includes(c)) return { kind: "class", item: c as ClassItem };
    if (!inClass && (c === "b" || c === "B")) return { kind: "assert", a: c === "b" ? "wb" : "nwb" };
    if (CONTROL_ESCAPES[c]) return { kind: "char", c: CONTROL_ESCAPES[c]! };
    if (c === "x" || c === "u") {
      const width = c === "x" ? 2 : 4;
      let hex = "";
      for (let i = 0; i < width; i++) {
        const h = this.next();
        if (!HEX.test(h)) throw new Refused("syntax");
        hex += h;
      }
      return { kind: "char", c: String.fromCharCode(Number.parseInt(hex, 16)) };
    }
    if (ALNUM.test(c)) throw new Refused("syntax");
    return { kind: "char", c };
  }

  private escape(): Node {
    const e = this.escaped(false);
    if (e.kind === "assert") return { k: "assert", a: e.a };
    if (e.kind === "class") return { k: "class", neg: false, items: [e.item] };
    return { k: "char", c: e.c };
  }

  private charClass(): Node {
    const neg = this.peek() === "^";
    if (neg) this.pos++;
    const items: ClassItem[] = [];
    if (this.peek() === "]") throw new Refused("syntax"); // an empty class matches nothing
    while (this.peek() !== "]") {
      const lo = this.classChar();
      const after = this.chars[this.pos + 1];
      if (this.peek() === "-" && after !== "]" && after !== undefined) {
        this.pos++;
        const hi = this.classChar();
        if (lo.kind !== "char" || hi.kind !== "char" || lo.c > hi.c) throw new Refused("syntax");
        items.push([lo.c, hi.c]);
      } else items.push(lo.kind === "char" ? [lo.c, lo.c] : lo.item);
    }
    this.pos++;
    return { k: "class", neg, items };
  }

  private classChar(): Exclude<Escape, { kind: "assert" }> {
    const c = this.next();
    if (c !== "\\") return { kind: "char", c };
    return this.escaped(true) as Exclude<Escape, { kind: "assert" }>;
  }

  private bound(): number {
    let digits = "";
    while (this.peek() !== undefined && DIGIT.test(this.peek()!)) digits += this.next();
    if (!digits || digits.length > 4) throw new Refused(digits ? "repeat-bound" : "syntax");
    return Number.parseInt(digits, 10);
  }

  private repeat(atom: Node): Node {
    const q = this.peek();
    if (q !== "*" && q !== "+" && q !== "?" && q !== "{") return atom;
    this.pos++;
    if (atom.k === "assert") throw new Refused("syntax");
    let min: number;
    let max: number | null;
    if (q === "*") [min, max] = [0, null];
    else if (q === "+") [min, max] = [1, null];
    else if (q === "?") [min, max] = [0, 1];
    else {
      min = this.bound();
      max = min;
      if (this.peek() === ",") {
        this.pos++;
        max = this.peek() === "}" ? null : this.bound();
      }
      if (this.next() !== "}") throw new Refused("syntax");
      if (max !== null && max < min) throw new Refused("syntax");
      if (min > PATTERN_LIMITS.maxRepeat || (max ?? 0) > PATTERN_LIMITS.maxRepeat)
        throw new Refused("repeat-bound");
    }
    const lazy = this.peek() === "?";
    if (lazy) this.pos++;
    const after = this.peek();
    if (after === "*" || after === "+" || after === "?" || after === "{") throw new Refused("syntax");
    if (containsRepeat(atom)) throw new Refused("nested-repeat");
    if (max === null) this.unbounded++;
    return { k: "rep", body: atom, min, max, lazy };
  }
}

function containsRepeat(node: Node): boolean {
  switch (node.k) {
    case "rep":
      return true;
    case "seq":
    case "alt":
      return node.items.some(containsRepeat);
    case "group":
      return containsRepeat(node.body);
    default:
      return false;
  }
}

// --- The program and its matcher (Pike VM) -------------------------------------------------------------------------

type Inst =
  | { op: "char"; c: string }
  | { op: "any" }
  | { op: "class"; neg: boolean; items: readonly ClassItem[] }
  | { op: "assert"; a: "bol" | "eol" | "wb" | "nwb" }
  | { op: "split"; x: number; y: number }
  | { op: "jmp"; x: number }
  | { op: "save"; n: number }
  | { op: "match" };

function compile(root: Node): Inst[] {
  const prog: Inst[] = [];
  const emit = (node: Node): void => {
    switch (node.k) {
      case "char":
        prog.push({ op: "char", c: node.c.toLowerCase() });
        return;
      case "any":
        prog.push({ op: "any" });
        return;
      case "class":
        prog.push({ op: "class", neg: node.neg, items: node.items });
        return;
      case "assert":
        prog.push({ op: "assert", a: node.a });
        return;
      case "seq":
        node.items.forEach(emit);
        return;
      case "group":
        if (node.index !== null) prog.push({ op: "save", n: 2 * node.index });
        emit(node.body);
        if (node.index !== null) prog.push({ op: "save", n: 2 * node.index + 1 });
        return;
      case "alt": {
        const jumps: { op: "jmp"; x: number }[] = [];
        node.items.forEach((item, i) => {
          if (i < node.items.length - 1) {
            const split = { op: "split" as const, x: prog.length + 1, y: 0 };
            prog.push(split);
            emit(item);
            const jmp = { op: "jmp" as const, x: 0 };
            prog.push(jmp);
            jumps.push(jmp);
            split.y = prog.length;
          } else emit(item);
        });
        for (const j of jumps) j.x = prog.length;
        return;
      }
      case "rep": {
        for (let i = 0; i < node.min; i++) emit(node.body);
        const prefer = (split: { x: number; y: number }, body: number, out: number) => {
          [split.x, split.y] = node.lazy ? [out, body] : [body, out];
        };
        if (node.max === null) {
          const loop = prog.length;
          const split = { op: "split" as const, x: 0, y: 0 };
          prog.push(split);
          emit(node.body);
          prog.push({ op: "jmp", x: loop });
          prefer(split, loop + 1, prog.length);
          return;
        }
        const splits: { split: { op: "split"; x: number; y: number }; body: number }[] = [];
        for (let i = node.min; i < node.max; i++) {
          const split = { op: "split" as const, x: 0, y: 0 };
          prog.push(split);
          splits.push({ split, body: prog.length });
          emit(node.body);
        }
        for (const s of splits) prefer(s.split, s.body, prog.length);
        return;
      }
    }
  };
  prog.push({ op: "save", n: 0 });
  emit(root);
  prog.push({ op: "save", n: 1 }, { op: "match" });
  return prog;
}

const isWord = (c: string | undefined): boolean => c !== undefined && /^[A-Za-z0-9_]$/.test(c);
const LINE_END = new Set(["\n", "\r", " ", " "]);

function inClass(items: readonly ClassItem[], c: string): boolean {
  const forms = [c, c.toLowerCase(), c.toUpperCase()];
  return items.some((item) => {
    switch (item) {
      case "d":
        return /^[0-9]$/.test(c);
      case "D":
        return !/^[0-9]$/.test(c);
      case "w":
        return isWord(c);
      case "W":
        return !isWord(c);
      case "s":
        return /^\s$/.test(c);
      case "S":
        return !/^\s$/.test(c);
      default:
        return forms.some((f) => f >= item[0] && f <= item[1]);
    }
  });
}

interface Thread {
  readonly pc: number;
  readonly caps: readonly number[];
}

function run(prog: readonly Inst[], slots: number, chars: readonly string[]): number[] | null {
  const lower = chars.map((c) => c.toLowerCase());
  const marks = new Int32Array(prog.length).fill(-1);
  let generation = 0;
  const add = (list: Thread[], start: Thread, pos: number, gen: number): void => {
    const stack: Thread[] = [start];
    while (stack.length > 0) {
      const t = stack.pop()!;
      if (marks[t.pc] === gen) continue;
      marks[t.pc] = gen;
      const inst = prog[t.pc]!;
      switch (inst.op) {
        case "jmp":
          stack.push({ pc: inst.x, caps: t.caps });
          break;
        case "split": // the preferred branch is taken first: pushed last
          stack.push({ pc: inst.y, caps: t.caps }, { pc: inst.x, caps: t.caps });
          break;
        case "save": {
          const caps = t.caps.slice();
          caps[inst.n] = pos;
          stack.push({ pc: t.pc + 1, caps });
          break;
        }
        case "assert": {
          const holds =
            inst.a === "bol"
              ? pos === 0
              : inst.a === "eol"
                ? pos === chars.length
                : (isWord(chars[pos - 1]) !== isWord(chars[pos])) === (inst.a === "wb");
          if (holds) stack.push({ pc: t.pc + 1, caps: t.caps });
          break;
        }
        default:
          list.push(t);
      }
    }
  };
  let current: Thread[] = [];
  let gen = generation++;
  let matched: number[] | null = null;
  for (let pos = 0; pos <= chars.length; pos++) {
    if (matched === null) add(current, { pc: 0, caps: new Array<number>(slots).fill(-1) }, pos, gen);
    if (current.length === 0 && matched !== null) break;
    const following: Thread[] = [];
    const nextGen = generation++;
    for (const t of current) {
      const inst = prog[t.pc]!;
      if (inst.op === "match") {
        matched = t.caps.slice();
        break; // lower-priority threads lose
      }
      const c = chars[pos];
      if (c === undefined) continue;
      const takes =
        inst.op === "char"
          ? inst.c === lower[pos]
          : inst.op === "any"
            ? !LINE_END.has(c)
            : inst.op === "class"
              ? inClass(inst.items, c) !== inst.neg
              : false;
      if (takes) add(following, { pc: t.pc + 1, caps: t.caps }, pos + 1, nextGen);
    }
    current = following;
    gen = nextGen;
  }
  return matched;
}

/** Parses and checks a pattern of the dialect; a refusal names the first rule it breaks. */
export function compilePattern(source: string): CompiledPattern {
  const chars = Array.from(source);
  if (chars.length > PATTERN_LIMITS.maxLength) return { ok: false, issue: "too-long" };
  if (chars.length === 0) return { ok: false, issue: "syntax" };
  const parser = new Parser(chars);
  let root: Node;
  try {
    root = parser.parse();
  } catch (error) {
    if (error instanceof Refused) return { ok: false, issue: error.issue };
    throw error;
  }
  if (parser.unbounded > PATTERN_LIMITS.maxUnbounded) return { ok: false, issue: "too-many-unbounded" };
  const prog = compile(root);
  const groups = parser.groups;
  const unbounded = parser.unbounded;
  let cost = 0;
  for (const inst of prog)
    cost += inst.op === "save" ? 1 + (groups + 1) / 4 : inst.op === "class" ? 1 + inst.items.length : 1;
  if (cost > PATTERN_LIMITS.maxProgramCost) return { ok: false, issue: "too-complex" };
  const limit = PATTERN_LIMITS.inputChars[unbounded as 0 | 1 | 2 | 3];
  return {
    ok: true,
    pattern: {
      source,
      groups,
      unbounded,
      match(text) {
        const chars = Array.from(text.slice(0, 2 * limit)).slice(0, limit);
        const caps = run(prog, 2 * (groups + 1), chars);
        if (!caps) return null;
        const out: (string | null)[] = [];
        for (let g = 0; g <= groups; g++) {
          const [s, e] = [caps[2 * g]!, caps[2 * g + 1]!];
          out.push(s < 0 || e < 0 ? null : chars.slice(s, e).join(""));
        }
        return out;
      },
    },
  };
}
