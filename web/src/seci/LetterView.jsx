import React, { useMemo, useState } from "react";
import { Download, FileText, Loader2, PenLine, RotateCcw, TriangleAlert } from "lucide-react";
import { letterOf, textFromNodes } from "./letters/index.js";
import { downloadLetters } from "./letters/export.js";

/** Text with its line breaks as <br>. */
function Lines({ text }) {
  const parts = String(text).split("\n");
  return parts.map((p, i) => (
    <React.Fragment key={i}>{p}{i < parts.length - 1 && <br />}</React.Fragment>
  ));
}

/** One run of a paragraph: plain text, or a value from the blanks (a chip kept out of editing). */
function Segment({ s }) {
  if (!s.key) return s.struck ? <s><Lines text={s.text} /></s> : <Lines text={s.text} />;
  const chip = (
    <span className={`letter-value ${s.missing ? "missing" : ""}`} contentEditable={false} data-key={s.key} data-filter={s.filter || ""}
      title={s.missing ? "A blank still to fill (Blanks view)" : "From the blanks: change it there and every letter follows"}>
      {s.text}
    </span>
  );
  return s.struck ? <s>{chip}</s> : chip;
}

/** A paragraph's runs, the runs of an inline alternative wrapped so an edit keeps the alternative. */
function Runs({ segments }) {
  const out = [];
  for (let i = 0; i < segments.length;) {
    const s = segments[i];
    if (!s.alt) {
      out.push(<Segment key={i} s={s} />);
      i += 1;
      continue;
    }
    const group = [];
    let j = i;
    while (j < segments.length && segments[j].alt?.piece === s.alt.piece) group.push(segments[j++]);
    out.push(
      <span key={i} className={s.struck ? "letter-alt struck" : "letter-alt"} data-alt-key={s.alt.key} data-alt-option={s.alt.option}
        title={s.struck ? `Struck out: "${s.alt.option}" is not chosen` : `Kept: "${s.alt.option}" is chosen`}>
        {group.map((g, k) => <Segment key={k} s={g} />)}
      </span>,
    );
    i = j;
  }
  return out;
}

function Block({ block, onEdit }) {
  const t = block.type;
  if (t === "table") {
    const header = block.rows.length > 1 && block.rows[0].length > 2;
    return (
      <table className="letter-table">
        <tbody>
          {block.rows.map((row, r) => (
            <tr key={r}>{row.map((cell, c) => (header && r === 0
              ? <th key={c}><Runs segments={cell} /></th>
              : <td key={c}><Runs segments={cell} /></td>))}</tr>
          ))}
        </tbody>
      </table>
    );
  }
  if (t === "heading") return <p className="letter-heading"><Runs segments={block.segments} /></p>;
  if (t === "subheading") return <p className="letter-subheading"><Runs segments={block.segments} /></p>;
  if (t === "note") return <p className="letter-note"><Runs segments={block.segments} /></p>;
  if (block.omitted) {
    return (
      <div className="letter-omitted" title="Left out of the letter">
        <small>{block.only === "consortium" ? "For a consortium only: not in this letter" : "For a single company only: not in this letter"}</small>
        <p><Runs segments={block.segments} /></p>
      </div>
    );
  }
  const editable = !block.struck;
  return (
    <div className={`letter-para ${block.struck ? "struck" : ""} ${block.edited ? "edited" : ""} ${block.choose ? "choose" : ""}`} data-testid={`letter-block-${block.index}`}>
      {block.struck && <small className="letter-flag">Struck out: the alternative not chosen ({block.cond.value} is not your choice)</small>}
      {block.choose && <small className="letter-flag warn">Choose in the blanks: {block.cond.key}</small>}
      <div
        // a new key after each saved edit gives React a fresh element to render into
        key={`${block.index}:${block.text}`}
        className="letter-text"
        contentEditable={editable}
        suppressContentEditableWarning
        spellCheck={editable}
        data-testid={`letter-text-${block.index}`}
        onBlur={(e) => { if (editable) onEdit(block, textFromNodes(e.currentTarget)); }}
      >
        {block.struck ? <s><Runs segments={block.segments} /></s> : <Runs segments={block.segments} />}
      </div>
      {block.edited && (
        <small className="letter-flag edited">
          <PenLine size={11} /> Your wording, changed from the RfS
          <button type="button" className="rtc-link" onClick={() => onEdit(block, null)} data-testid={`letter-revert-${block.index}`}><RotateCcw size={11} /> Revert to the RfS wording</button>
        </small>
      )}
    </div>
  );
}

/**
 * A format as its letter: the RfS wording with the blanks filled, the alternatives not chosen
 * struck out, each paragraph editable in place (kept with the bid, marked, revertible), and the
 * letter as Word or PDF. letterOf and download default to the SECI RTC pack's; another pack (the
 * CfD tab) passes its own.
 */
export default function LetterView({ state, setState, format, letterOf: letterFn = letterOf, download: downloadFn = downloadLetters, testid = "seci-letter" }) {
  const letter = useMemo(() => letterFn(state, format), [state, format, letterFn]);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  if (!letter) return <p className="rtc-note">No letter for this format.</p>;

  function onEdit(block, text) {
    setState((s) => {
      const forFormat = { ...(s.letters?.[format.id] || {}) };
      // an edit back to the RfS wording is no edit
      if (text === null || text.trim() === String(block.original ?? "").trim()) delete forFormat[block.index];
      else if (text.trim() === String(block.text).trim()) return s;
      else forFormat[block.index] = text.replace(/\s+$/, "");
      return { ...s, letters: { ...(s.letters || {}), [format.id]: forFormat } };
    });
  }

  async function download(kind) {
    setBusy(kind);
    setError("");
    try { await downloadFn([letter], kind); } catch (err) { setError(err.message); } finally { setBusy(""); }
  }

  return (
    <div className="letter-view" data-testid={testid}>
      <div className="letter-tools">
        <span className="rtc-note">
          Click a paragraph to change its wording; values from the blanks stay linked. Headings, the RfS's notes and tables stay as printed.
          {letter.edited > 0 && <b> {letter.edited} paragraph{letter.edited > 1 ? "s" : ""} in your wording.</b>}
        </span>
        <span className="letter-buttons">
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => download("word")} data-testid={`${testid}-word`}>
            {busy === "word" ? <Loader2 className="spin" size={13} /> : <FileText size={13} />} Word
          </button>
          <button type="button" className="secondary" disabled={Boolean(busy)} onClick={() => download("pdf")} data-testid={`${testid}-pdf`}>
            {busy === "pdf" ? <Loader2 className="spin" size={13} /> : <Download size={13} />} PDF
          </button>
        </span>
      </div>
      {error && <div className="alert"><TriangleAlert size={14} /> {error}</div>}
      {letter.missing.length > 0 && (
        <div className="alert warn" data-testid={`${testid}-missing`}><TriangleAlert size={14} /> {letter.missing.length} blank{letter.missing.length > 1 ? "s" : ""} still empty: {letter.missing.join(", ")}</div>
      )}
      <article className="letter-paper">
        {letter.letterhead ? (
          <header className="letter-letterhead">
            <strong>{letter.bidder || "Your company's letterhead"}</strong>
            <small>{String(letter.address || "").replace(/\n/g, ", ")}</small>
          </header>
        ) : (
          <header className="letter-stamp"><small>Printed on: {letter.paper}</small></header>
        )}
        {letter.blocks.map((b) => <Block key={b.index} block={b} onEdit={onEdit} />)}
      </article>
    </div>
  );
}
