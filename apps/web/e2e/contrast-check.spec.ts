import { expect, test } from "@playwright/test";
import { findContrastProblems } from "./contrast.ts";

/**
 * DS-06@PoC AC2: the contrast check itself finds what it must (a check that passes everything proves nothing).
 * A synthetic page with named CSS colours; no app, no server.
 */
test("DS-06@PoC AC2: the check reports low-contrast text, a faint control, unmeasurable text; passes good ones", async ({
  page,
}) => {
  await page.setContent(`
    <body style="margin:0;background:white">
      <p id="good" style="color:black">Читабельний текст</p>
      <p id="faint" style="color:silver">Блідий текст</p>
      <div style="background:navy"><span id="dim-on-dark" style="color:slateblue">Темне на темному</span></div>
      <p id="half" style="color:black;opacity:0.2">Напівпрозорий текст</p>
      <p style="color:silver" aria-disabled="true">Неактивний текст</p>
      <p style="color:silver;position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Лише для скрінрідера</p>
      <div style="background-image:linear-gradient(white, black)"><span id="gradient" style="color:black">На градієнті</span></div>
      <input id="faint-field" style="border:1px solid gainsboro;background:white;color:black" value="поле">
      <input id="good-field" style="border:1px solid gray;background:white;color:black" value="поле">
      <button id="good-button" style="border:0;background:navy;color:white">Кнопка</button>
      <button id="text-button" style="border:0;background:transparent;color:navy">Тиха кнопка</button>
      <div style="background:navy"><span data-contrast-kind="ui" id="ui-sample" style="color:royalblue">Аа</span></div>
    </body>`);
  const problems = await page.evaluate(findContrastProblems);
  const found = problems.map((p) => `${p.kind} ${p.element.split(" > ").pop()}`).sort();
  expect(found).toEqual(
    [
      "text p#faint",
      "text span#dim-on-dark",
      "text p#half",
      "unmeasurable span#gradient",
      "ui input#faint-field",
    ].sort(),
  );
  expect(problems.find((p) => p.element.endsWith("p#faint"))).toMatchObject({ required: 4.5 });
});
