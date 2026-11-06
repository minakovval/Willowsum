/**
 * Base class for errors raised by domain rules. `code` is a stable machine code (it ends up in the API's
 * problem details); `message` must never contain personal or financial data (ARC-09, NFR-10).
 */
export class DomainError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = new.target.name;
    this.code = code;
  }
}
