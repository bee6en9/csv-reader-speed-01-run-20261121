// csv-reader, faster: a single-pass, byte-identical re-implementation of csv-reader 1.0.0.
// Written from the RULES.txt spec and the reference behaviour in vendor/csv-reader/index.js.
// Strategy: one left-to-right pass. Records whose line holds no quote and no stray CR
// take a fast path (indexOf for commas, one slice per field). Anything with a quote or
// a CR falls back to field readers that scan with charCodeAt and slice whole fields
// instead of building them one character at a time. No regex, no String.split, no imports.

/** How a field ended: 0 = comma, 1 = line break, 2 = end of text. */
const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input: {columns, rows, errors}. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1; // drop a leading U+FEFF

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // The last field read: how it ended, and (for an unquoted read) how many characters it kept.
  let fieldEnded = END;
  let fieldAdded = 0;

  // Line breaks counted inside the quoted segment being read; committed only if the quote closes.
  let segLines = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `value` up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Returns the field; sets fieldEnded / fieldAdded.
  function readUnquoted(value) {
    let added = 0;
    for (;;) {
      // Scan to the next delimiter (, LF or CR), then take the whole run as one slice.
      let i = pos;
      while (i < len) {
        const c = text.charCodeAt(i);
        if (c === 44 || c === 10 || c === 13) break;
        i++;
      }
      if (i > pos) {
        value += text.slice(pos, i);
        added += i - pos;
        pos = i;
      }
      if (pos >= len) {
        fieldEnded = END;
        fieldAdded = added;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        fieldEnded = COMMA;
        fieldAdded = added;
        return value;
      }
      if (c === 10) {
        pos++;
        line++;
        fieldEnded = LINE_BREAK;
        fieldAdded = added;
        return value;
      }
      // CR: a line break when followed by LF, else a dropped stray CR (stray_cr).
      if (pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
        fieldEnded = LINE_BREAK;
        fieldAdded = added;
        return value;
      }
      error('stray_cr');
      pos++;
    }
  }

  // The quoted segment [a, b) with each CRLF or lone CR read as one LF; counts the line
  // breaks it held into segLines. Fast when the segment holds no line break at all.
  function quotedSegment(a, b) {
    let i = a;
    while (i < b) {
      const c = text.charCodeAt(i);
      if (c === 13 || c === 10) break;
      i++;
    }
    if (i === b) return text.slice(a, b);
    let out = text.slice(a, i);
    while (i < b) {
      const c = text.charCodeAt(i);
      if (c === 13) {
        out += '\n';
        segLines++;
        i += i + 1 < b && text.charCodeAt(i + 1) === 10 ? 2 : 1;
      } else if (c === 10) {
        out += '\n';
        segLines++;
        i++;
      } else {
        let j = i + 1;
        while (j < b) {
          const d = text.charCodeAt(j);
          if (d === 13 || d === 10) break;
          j++;
        }
        out += text.slice(i, j);
        i = j;
      }
    }
    return out;
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field; sets fieldEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    segLines = 0;
    let start = pos + 1;
    for (;;) {
      const q = text.indexOf('"', start);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it is
        // read again as unquoted (unterminated_quote).
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote in the value, and the field goes on.
        value += quotedSegment(start, q);
        value += '"';
        start = q + 2;
        continue;
      }
      // The closing quote: the field's value is the segment up to it.
      value += quotedSegment(start, q);
      line += segLines;
      pos = q + 1;
      if (pos >= len) {
        fieldEnded = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) {
        pos++;
        fieldEnded = COMMA;
        return value;
      }
      if (c === 10) {
        pos++;
        line++;
        fieldEnded = LINE_BREAK;
        return value;
      }
      if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
        fieldEnded = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the next comma
      // or line break (quote_junk, when the field ends).
      const junk = readUnquoted(value);
      if (fieldAdded > 0) error('quote_junk');
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && pos + 1 < len && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    // Fast path: this record's line holds no quote and no stray CR, so the record is
    // just comma-separated fields up to its line break (a CRLF counts as one break).
    const li = text.indexOf('\n', pos);
    const lineEnd = li === -1 ? len : li;
    const qi = text.indexOf('"', pos);
    const cri = text.indexOf('\r', pos);
    let fields = null;
    let quoted = false;
    if ((qi === -1 || qi >= lineEnd) && (cri === -1 || cri >= lineEnd || (li !== -1 && cri === li - 1))) {
      const contentEnd = li !== -1 && cri === li - 1 ? li - 1 : lineEnd;
      fields = [];
      let start = pos;
      for (;;) {
        const ci = text.indexOf(',', start);
        if (ci === -1 || ci >= contentEnd) {
          fields.push(text.slice(start, contentEnd));
          break;
        }
        fields.push(text.slice(start, ci));
        start = ci + 1;
      }
      pos = li === -1 ? len : li + 1;
      if (li !== -1) line++;
    } else {
      // Slow path: read the record field by field.
      fields = [];
      do {
        quoted = text.charCodeAt(pos) === 34;
        fields.push(quoted ? readQuoted() : readUnquoted(''));
      } while (fieldEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
