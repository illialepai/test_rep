import { test } from "node:test";
import assert from "node:assert/strict";
import { STYLES, getStyle } from "../src/core/styles.js";
import { transform, generateAll, describeChars } from "../src/core/transform.js";
import { sanitizeInput, stripInvalid, classifyChar, validateOutput, STATUS } from "../src/core/validate.js";

const ALL = "abcdefghijklmnopqrstuvwxyz0123456789_.";

// Expected output for the full alphabet, written out by hand so the
// offset arithmetic in styles.js is checked against real characters.
const EXPECTED = {
  plain: "abcdefghijklmnopqrstuvwxyz0123456789_.",
  "small-caps": "ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘqʀꜱᴛᴜᴠᴡxʏᴢ0123456789_.",
  bold: "𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗_.",
  italic: "𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧0123456789_.",
  "bold-italic": "𝒂𝒃𝒄𝒅𝒆𝒇𝒈𝒉𝒊𝒋𝒌𝒍𝒎𝒏𝒐𝒑𝒒𝒓𝒔𝒕𝒖𝒗𝒘𝒙𝒚𝒛0123456789_.",
  sans: "𝖺𝖻𝖼𝖽𝖾𝖿𝗀𝗁𝗂𝗃𝗄𝗅𝗆𝗇𝗈𝗉𝗊𝗋𝗌𝗍𝗎𝗏𝗐𝗑𝗒𝗓𝟢𝟣𝟤𝟥𝟦𝟧𝟨𝟩𝟪𝟫_.",
  "sans-bold": "𝗮𝗯𝗰𝗱𝗲𝗳𝗴𝗵𝗶𝗷𝗸𝗹𝗺𝗻𝗼𝗽𝗾𝗿𝘀𝘁𝘂𝘃𝘄𝘅𝘆𝘇𝟬𝟭𝟮𝟯𝟰𝟱𝟲𝟳𝟴𝟵_.",
  "sans-italic": "𝘢𝘣𝘤𝘥𝘦𝘧𝘨𝘩𝘪𝘫𝘬𝘭𝘮𝘯𝘰𝘱𝘲𝘳𝘴𝘵𝘶𝘷𝘸𝘹𝘺𝘻0123456789_.",
  "sans-bold-italic": "𝙖𝙗𝙘𝙙𝙚𝙛𝙜𝙝𝙞𝙟𝙠𝙡𝙢𝙣𝙤𝙥𝙦𝙧𝙨𝙩𝙪𝙫𝙬𝙭𝙮𝙯0123456789_.",
  monospace: "𝚊𝚋𝚌𝚍𝚎𝚏𝚐𝚑𝚒𝚓𝚔𝚕𝚖𝚗𝚘𝚙𝚚𝚛𝚜𝚝𝚞𝚟𝚠𝚡𝚢𝚣𝟶𝟷𝟸𝟹𝟺𝟻𝟼𝟽𝟾𝟿_.",
  script: "𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏0123456789_.",
  "bold-script": "𝓪𝓫𝓬𝓭𝓮𝓯𝓰𝓱𝓲𝓳𝓴𝓵𝓶𝓷𝓸𝓹𝓺𝓻𝓼𝓽𝓾𝓿𝔀𝔁𝔂𝔃0123456789_.",
  fraktur: "𝔞𝔟𝔠𝔡𝔢𝔣𝔤𝔥𝔦𝔧𝔨𝔩𝔪𝔫𝔬𝔭𝔮𝔯𝔰𝔱𝔲𝔳𝔴𝔵𝔶𝔷0123456789_.",
  "bold-fraktur": "𝖆𝖇𝖈𝖉𝖊𝖋𝖌𝖍𝖎𝖏𝖐𝖑𝖒𝖓𝖔𝖕𝖖𝖗𝖘𝖙𝖚𝖛𝖜𝖝𝖞𝖟0123456789_.",
  "double-struck": "𝕒𝕓𝕔𝕕𝕖𝕗𝕘𝕙𝕚𝕛𝕜𝕝𝕞𝕟𝕠𝕡𝕢𝕣𝕤𝕥𝕦𝕧𝕨𝕩𝕪𝕫𝟘𝟙𝟚𝟛𝟜𝟝𝟞𝟟𝟠𝟡_.",
  fullwidth: "ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ０１２３４５６７８９＿．",
  circled: "ⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ⓪①②③④⑤⑥⑦⑧⑨_.",
  superscript: "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖqʳˢᵗᵘᵛʷˣʸᶻ⁰¹²³⁴⁵⁶⁷⁸⁹_.",
  subscript: "ₐbcdₑfgₕᵢⱼₖₗₘₙₒₚqᵣₛₜᵤᵥwₓyz₀₁₂₃₄₅₆₇₈₉_.",
};

test("every registered style has a hand-checked expectation", () => {
  assert.deepEqual(STYLES.map((s) => s.id).sort(), Object.keys(EXPECTED).sort());
});

for (const style of STYLES) {
  test(`style "${style.id}" maps the full alphabet correctly`, () => {
    const { output } = transform(ALL, style);
    assert.equal(output, EXPECTED[style.id]);
    // One output code point per input character, so length limits still apply.
    assert.equal([...output].length, [...ALL].length);
  });

  test(`style "${style.id}" outputs real Unicode, with no reserved or private-use code points`, () => {
    for (const ch of Object.values(style.map)) {
      assert.equal([...ch].length, 1, `mapping "${ch}" must be one code point`);
      assert.match(ch, /^[\p{L}\p{N}\p{S}\p{P}]$/u, `${ch} must be an assigned, visible character`);
    }
  });
}

test("styled output really differs from the plain input", () => {
  const out = transform("username", getStyle("bold")).output;
  assert.notEqual(out, "username");
  assert.equal(out.codePointAt(0), 0x1d42e); // MATHEMATICAL BOLD SMALL U
});

test("sanitize: empty input and @-only input are errors", () => {
  assert.equal(sanitizeInput("").errors.length, 1);
  assert.equal(sanitizeInput("   ").errors.length, 1);
  assert.equal(sanitizeInput("@").errors[0], "Enter a username to generate styles.");
});

test("sanitize: leading @, spaces and uppercase are fixed with notices", () => {
  const r = sanitizeInput("  @@My User  ");
  assert.equal(r.value, "my_user");
  assert.equal(r.errors.length, 0);
  assert.equal(r.notices.length, 3);
});

test("sanitize: emoji, symbols and accents are rejected and listed", () => {
  const r = sanitizeInput("cool😀name!é");
  assert.deepEqual(r.invalidChars, ["😀", "!", "é"]);
  assert.match(r.errors[0], /U\+1F600/);
  assert.equal(stripInvalid(r.value), "coolname");
});

test("sanitize: length limits and trailing period", () => {
  assert.match(sanitizeInput("a").errors[0], /at least 2/);
  assert.match(sanitizeInput("a".repeat(25)).errors[0], /at most 24/);
  assert.equal(sanitizeInput("a".repeat(24)).errors.length, 0);
  assert.match(sanitizeInput("name.").errors[0], /end with a period/);
  assert.equal(sanitizeInput("na.me_99").errors.length, 0);
});

test("classifyChar tiers", () => {
  assert.equal(classifyChar("a").status, STATUS.LIKELY);
  assert.equal(classifyChar("ᴀ").status, STATUS.LIKELY); // letter, not NFKC-folded
  assert.equal(classifyChar("𝐚").status, STATUS.MAYBE); // folds to a
  assert.equal(classifyChar("ａ").status, STATUS.MAYBE);
  assert.equal(classifyChar("＿").status, STATUS.MAYBE); // folds to _
  assert.equal(classifyChar("ⓐ").status, STATUS.UNSUPPORTED); // symbol (So)
  assert.equal(classifyChar("😀").status, STATUS.UNSUPPORTED);
});

test("validateOutput flags untransformed letters and length", () => {
  const r = validateOutput("ǫx", ["x"]);
  assert.ok(r.warnings.some((w) => w.includes('"x"')));
  assert.equal(validateOutput("𝐚").status, STATUS.UNSUPPORTED);
});

test("generateAll: no duplicates, Standard first, digit-only input drops letter-only styles", () => {
  const results = generateAll("myusername");
  assert.equal(results[0].style.id, "plain");
  assert.equal(new Set(results.map((r) => r.output)).size, results.length);
  assert.equal(results.length, STYLES.length);

  const digits = generateAll("1234");
  assert.ok(!digits.some((r) => r.style.id === "italic"));
  assert.ok(digits.some((r) => r.style.id === "bold"));
});

test("describeChars returns code points", () => {
  const d = describeChars(transform("ab", getStyle("bold")).output);
  assert.deepEqual(
    d.map((c) => c.codePoint),
    ["U+1D41A", "U+1D41B"],
  );
  assert.equal(d[0].category.code, "Ll");
});
