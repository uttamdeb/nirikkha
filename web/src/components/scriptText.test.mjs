const UNCLEAR = /\[\[\s*অস্পষ্ট(?:\s*লাইন)?\s*\]\]/g;
const MATH = /\$\$([^$]+?)\$\$|\$([^$\n]+?)\$/g;

function parse(source) {
  const pieces = [];
  let cursor = 0;
  UNCLEAR.lastIndex = 0;
  const pushText = (run) => {
    let at = 0; MATH.lastIndex = 0;
    for (let m = MATH.exec(run); m; m = MATH.exec(run)) {
      if (m.index > at) pieces.push({ kind: "text", value: run.slice(at, m.index) });
      pieces.push({ kind: "math", value: m[1] ?? m[2] ?? "", display: Boolean(m[1]) });
      at = m.index + m[0].length;
    }
    if (at < run.length) pieces.push({ kind: "text", value: run.slice(at) });
  };
  for (let m = UNCLEAR.exec(source); m; m = UNCLEAR.exec(source)) {
    if (m.index > cursor) pushText(source.slice(cursor, m.index));
    pieces.push({ kind: "unclear", whole: m[0].includes("লাইন") });
    cursor = m.index + m[0].length;
  }
  if (cursor < source.length) pushText(source.slice(cursor));
  return pieces;
}

const cases = [
  ["real line 2 from the script", "* মুখে উচ্চারিত শব্দের ক্ষুদ্রতম অংশকে বলে $\\rightarrow$ ধ্বনি।", 1, 0],
  ["real line 12", "* যে স্বরধ্বনি দুইটি স্বরধ্বনি মিলে হয় $\\rightarrow$ যৌগিক স্বরধ্বনি", 1, 0],
  ["two maths spans", "a = $F/m$ = $\\frac{20}{5}$ = 4", 2, 0],
  ["unclear markers", "ঘ) ভর [[অস্পষ্ট]] হলে একই বলে [[অস্পষ্ট]] কমে যাবে।", 0, 2],
  ["whole line unclear", "[[অস্পষ্ট লাইন]]", 0, 1],
  ["maths and unclear together", "$a=F/m$ তাই [[অস্পষ্ট]] হবে", 1, 1],
  ["no maths, plain Bangla", "ক) ত্বরণ হলো বেগের পরিবর্তনের হার।", 0, 0],
  ["a lone dollar is not maths", "দাম $50 টাকা", 0, 0],
  ["display maths", "$$E = mc^2$$", 1, 0],
];

let pass = 0, fail = 0;
for (const [label, src, wantMath, wantUnclear] of cases) {
  const p = parse(src);
  const m = p.filter(x => x.kind === "math").length;
  const u = p.filter(x => x.kind === "unclear").length;
  const rebuilt = p.map(x => x.kind === "text" ? x.value : x.kind === "math" ? `$${x.value}$` : "<?>").join("");
  const lossless = rebuilt.replace(/<\?>/g, "").length > 0 || src.startsWith("[[");
  const ok = m === wantMath && u === wantUnclear && lossless;
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m"} ${label.padEnd(28)} math=${m}/${wantMath} unclear=${u}/${wantUnclear}`);
}
console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
