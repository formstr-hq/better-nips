import { type CSSProperties, type ElementType, type ReactNode } from "react";

/**
 * A deliberately small Markdown renderer that returns React nodes (never raw
 * HTML — no injection surface). It covers what a NIP actually uses: headings,
 * fenced + inline code, lists, blockquotes, rules, links, bold/italic. Anything
 * it doesn't recognize falls through as plain text, so unknown syntax is shown
 * verbatim rather than dropped.
 */
export function Markdown({ source }: { source: string }) {
  return <>{renderBlocks(source)}</>;
}

function renderBlocks(src: string): ReactNode[] {
  const lines = src.replace(/\r\n/g, "\n").split("\n");
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;
  const k = () => `b${key++}`;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code block.
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++; // closing fence
      out.push(
        <pre className="md-pre" key={k()}>
          <code>{body.join("\n")}</code>
        </pre>,
      );
      continue;
    }

    // Blank line.
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule.
    if (/^(\s*[-*_]){3,}\s*$/.test(line)) {
      out.push(<hr className="md-hr" key={k()} />);
      i++;
      continue;
    }

    // Heading.
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      const Tag = `h${Math.min(level + 1, 6)}` as ElementType;
      out.push(
        <Tag className="md-h" key={k()}>
          {renderInline(heading[2])}
        </Tag>,
      );
      i++;
      continue;
    }

    // GFM table: a header row of `|`-separated cells, then a delimiter row
    // (`| --- | :--: |`), then body rows until a blank line.
    const nextLine = lines[i + 1];
    if (
      line.includes("|") &&
      nextLine !== undefined &&
      /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(nextLine)
    ) {
      const headers = parseTableRow(line);
      const aligns = parseTableRow(nextLine).map((c) => {
        const left = c.startsWith(":");
        const right = c.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : undefined;
      });
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim() !== "" && lines[i].includes("|")) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      out.push(
        <div className="md-table-wrap" key={k()}>
          <table className="md-table">
            <thead>
              <tr>
                {headers.map((h, c) => (
                  <th key={c} style={alignStyle(aligns[c])}>
                    {renderInline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={r}>
                  {headers.map((_, c) => (
                    <td key={c} style={alignStyle(aligns[c])}>
                      {renderInline(row[c] ?? "")}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }

    // Blockquote.
    if (/^>\s?/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        body.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      out.push(
        <blockquote className="md-quote" key={k()}>
          {renderBlocks(body.join("\n"))}
        </blockquote>,
      );
      continue;
    }

    // Lists (consecutive ordered or unordered items).
    if (/^\s*([-*+]|\d+\.)\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*+]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+\.)\s+/, ""));
        i++;
      }
      const lis = items.map((it, idx) => (
        <li key={idx}>{renderInline(it)}</li>
      ));
      out.push(
        ordered ? (
          <ol className="md-list" key={k()}>
            {lis}
          </ol>
        ) : (
          <ul className="md-list" key={k()}>
            {lis}
          </ul>
        ),
      );
      continue;
    }

    // Setext heading: a line of text underlined by `===` (h1) or `---` (h2).
    // Without this, `Title\n=====` collapses into one paragraph ("Title ====")
    // — a very common shape in NIP markdown.
    const underline = lines[i + 1];
    if (underline !== undefined && /^(=+|-+)\s*$/.test(underline)) {
      const level = underline.trim().startsWith("=") ? 1 : 2;
      const Tag = `h${Math.min(level + 1, 6)}` as ElementType;
      out.push(
        <Tag className="md-h" key={k()}>
          {renderInline(line)}
        </Tag>,
      );
      i += 2; // consume the text line and its underline
      continue;
    }

    // Paragraph: gather until a blank line or a block starter.
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,6}\s|>\s?|```|\s*([-*+]|\d+\.)\s+|(\s*[-*_]){3,}\s*$)/.test(
        lines[i],
      )
    ) {
      para.push(lines[i]);
      i++;
    }
    out.push(
      <p className="md-p" key={k()}>
        {renderInline(para.join(" "))}
      </p>,
    );
  }

  return out;
}

/** Split a table row into trimmed cells, tolerating optional edge pipes. */
function parseTableRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function alignStyle(align?: string): CSSProperties | undefined {
  return align ? { textAlign: align as "left" | "right" | "center" } : undefined;
}

// Inline: code spans first (so their content isn't re-parsed), then links,
// then bold, then italic, then bare URLs.
function renderInline(text: string): ReactNode[] {
  return splitInlineCode(text);
}

function splitInlineCode(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...renderEmphasis(text.slice(last, m.index)));
    out.push(<code className="md-code" key={`c${key++}`}>{m[1]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...renderEmphasis(text.slice(last)));
  return out;
}

function renderEmphasis(text: string): ReactNode[] {
  // Links first so their label can still carry emphasis-free text.
  const out: ReactNode[] = [];
  const linkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = linkRe.exec(text))) {
    if (m.index > last) out.push(...renderBoldItalic(text.slice(last, m.index)));
    out.push(
      <a
        className="md-link"
        key={`l${key++}`}
        href={m[2]}
        target="_blank"
        rel="noopener noreferrer"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...renderBoldItalic(text.slice(last)));
  return out;
}

function renderBoldItalic(text: string): ReactNode[] {
  // Bold (**x** / __x__), then italic (*x* / _x_), then autolink bare URLs.
  const out: ReactNode[] = [];
  const re = /(\*\*|__)(.+?)\1|(\*|_)(.+?)\3/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(...autolink(text.slice(last, m.index), key++));
    if (m[2] != null) {
      out.push(<strong key={`s${key++}`}>{m[2]}</strong>);
    } else {
      out.push(<em key={`e${key++}`}>{m[4]}</em>);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(...autolink(text.slice(last), key++));
  return out;
}

function autolink(text: string, seed: number): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(https?:\/\/[^\s)]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <a
        className="md-link"
        key={`a${seed}-${key++}`}
        href={m[1]}
        target="_blank"
        rel="noopener noreferrer"
      >
        {m[1]}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
