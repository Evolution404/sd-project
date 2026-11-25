// Excel quotes cells containing tabs, line breaks or escaped double quotes.
export function parseSpreadsheetText(source: string): string[][] | null {
  const text = source.replace(/\r\n?/g, "\n");
  const rows: string[][] = [[]];
  let value = "";
  let quoted = false;
  let closedQuote = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[index + 1] === '"') {
        value += '"';
        index++;
      } else {
        quoted = false;
        closedQuote = true;
      }
    } else if (char === "\t" || char === "\n") {
      rows.at(-1)?.push(value);
      value = "";
      closedQuote = false;
      if (char === "\n") rows.push([]);
    } else if (closedQuote) return null;
    else if (char === '"' && !value) quoted = true;
    else value += char;
  }
  if (quoted) return null;
  if (text.endsWith("\n")) rows.pop();
  else rows.at(-1)?.push(value);
  const width = rows[0]?.length;
  return width && rows.every(row => row.length === width) ? rows : null;
}

/** Adapt clipboard text to Univer's native rectangular paste path. No business writes. */
export function literalClipboardTable(source: string): string | null {
  const rows = /[\t\r\n]/.test(source) ? parseSpreadsheetText(source) : [[source]];
  if (!rows) return null;
  const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;")
    .replaceAll("\n", "<br>").replaceAll("\t", "&#9;");
  return "<table>" + rows.map(row => "<tr>" + row.map(value =>
    '<td style="white-space:pre-wrap;mso-number-format:\'\\@\'">' + escape(value) + "</td>").join("") + "</tr>").join("") + "</table>";
}
