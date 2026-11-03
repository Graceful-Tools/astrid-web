"use client"

import { useEffect, useState } from "react"
import { DecisionCards } from "@/components/task-detail/DecisionCards"
import { parseDecision, ratingLabels, RATING_STYLE, type Rating } from "@/lib/comment-formats"
import { useTranslations } from "@/lib/i18n/client"
import { DECISION_EXAMPLE } from "@/lib/decision-examples"

/**
 * How to write a Decision and a trade-off grid, with the canonical example shown as source and as
 * it draws (AWTD-1531). Used on the help page (people) and /docs/mcp (agents). The full guide is
 * docs/DECISIONS.md; both quote the same example from lib/decision-examples.ts.
 */
export function DecisionFormatGuide({ audience }: { audience: "people" | "agents" }) {
  const decision = parseDecision(DECISION_EXAMPLE)
  // Rating names match the live example and the in-app key, in the reader's language.
  const { t } = useTranslations()
  const labels = ratingLabels(t)
  // The markdown renderer sanitises only in the browser, so the drawn example waits for mount
  // rather than hydrating over the server's plain-text fallback.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const tokens: Rating[] = ["--", "-", "~", "+", "++"]
  const code = "px-1 py-0.5 theme-bg-tertiary rounded font-mono text-xs"

  return (
    <div className="space-y-4 text-sm theme-text-secondary" data-testid="decision-format-guide">
      <p>
        A comment that asks someone to choose can be drawn as tappable cards, with a coloured grid that
        weighs the options. Both are ordinary markdown, so they still read well anywhere they aren&apos;t
        drawn (email, plain text): the reader just types the number.
      </p>

      <div className="space-y-2">
        <h3 className="font-semibold theme-text-primary">A Decision</h3>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Start a paragraph with <code className={code}>**Decision:**</code> and the question.
          </li>
          <li>
            Follow it with a list whose items start with a bold number: <code className={code}>- **1.** Ship today</code>.
            At least two options. The cards are numbered 1, 2, 3 in order.
          </li>
          <li>
            Add <code className={code}>(recommended)</code> to the one option you would pick. It gets a badge.
          </li>
          <li>
            Tapping a card posts <code className={code}>1 — Ship today</code> as the reply. A link inside an
            option opens the link instead.
          </li>
        </ul>
      </div>

      <div className="space-y-2">
        <h3 className="font-semibold theme-text-primary">A trade-off grid</h3>
        <p>
          A table with one row per option and one column per criterion. Every cell starts with a rating, then a
          few words of reason:
        </p>
        <ul className="space-y-1">
          {tokens.map(token => (
            <li key={token} className="flex items-center gap-2">
              <span className={`tradeoff-swatch ${RATING_STYLE[token].className}`} />
              <code className={code}>{token}</code>
              <span>{labels[RATING_STYLE[token].labelKey] || RATING_STYLE[token].label}</span>
            </li>
          ))}
        </ul>
        <p>
          🔴 🟡 🟢 also work, as poor, mixed and good. Under the table, explain each criterion in a list such as{" "}
          <code className={code}>- **Cost:** what the company pays</code>.
        </p>
      </div>

      {audience === "agents" && (
        <div className="space-y-2">
          <h3 className="font-semibold theme-text-primary">When to use them</h3>
          <ul className="list-disc pl-5 space-y-1">
            <li>Any question to a person with two to five discrete answers is a Decision.</li>
            <li>Recommend exactly one option. Keep option text short: it is posted back verbatim.</li>
            <li>Add a grid when options trade off against several criteria: rows numbered to match (1. Lisbon), 3–5 columns, which the apps letter A, B, C.</li>
            <li>Every cell is a rating plus a concrete reason, never a bare colour.</li>
            <li>
              End a handback with the <code className={code}>AGENT-HANDBACK: &lt;mailbox&gt;</code> line, last.
            </li>
            <li>To show the format as an example, put it in a code block. It stays code there.</li>
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h3 className="font-semibold theme-text-primary">A complete example</h3>
        <pre className="theme-bg-tertiary p-3 rounded-lg overflow-x-auto">
          <code className="text-xs font-mono theme-text-primary">{DECISION_EXAMPLE}</code>
        </pre>
        <p>It draws like this:</p>
        {mounted && decision && (
          <div className="rounded-xl border theme-border p-3 max-w-md">
            <DecisionCards decision={decision} chosen={null} />
          </div>
        )}
      </div>
    </div>
  )
}
