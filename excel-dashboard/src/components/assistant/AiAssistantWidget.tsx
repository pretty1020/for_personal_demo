import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useDemoSession } from '../../context/DemoSessionContext'
import { buildAssistantContext } from '../../data/buildAssistantContext'
import { sendAssistantMessage, type AssistantChatMessage } from '../../data/assistantApi'
import {
  ASSISTANT,
  ASSISTANT_QUICK_PROMPTS,
  buildAnalystWelcome,
  executiveFirstName,
} from './analystPersona'
import { AssistantAvatar } from './AssistantAvatar'

function TypingIndicator() {
  return (
    <div className="ai-analyst-thread ai-analyst-thread--agent">
      <AssistantAvatar size="md" />
      <div className="ai-analyst-bubble ai-analyst-bubble--agent ai-analyst-bubble--typing">
        <p className="ai-analyst-bubble__meta">{ASSISTANT.name} · thinking</p>
        <div className="ai-analyst-typing" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  )
}

function MessageThread({ message }: { message: AssistantChatMessage }) {
  const isAgent = message.role === 'assistant'
  return (
    <div className={`ai-analyst-thread${isAgent ? ' ai-analyst-thread--agent' : ' ai-analyst-thread--exec'}`}>
      {isAgent ? <AssistantAvatar size="md" /> : null}
      <div className={`ai-analyst-bubble${isAgent ? ' ai-analyst-bubble--agent' : ' ai-analyst-bubble--exec'}`}>
        <p className="ai-analyst-bubble__meta">{isAgent ? ASSISTANT.name : 'You · Executive'}</p>
        <div className="ai-analyst-bubble__body">{message.content}</div>
      </div>
    </div>
  )
}

function pageLabelFromPath(pathname: string): string {
  if (pathname.startsWith('/financial')) return 'Financials'
  if (pathname.startsWith('/capacity-plan/seats')) return 'Seats'
  if (pathname.startsWith('/capacity-plan')) return 'Capacity'
  if (pathname.startsWith('/planning')) return 'Planning Scenario'
  if (pathname.startsWith('/forecasting')) return 'Forecasting'
  if (pathname.startsWith('/roster')) return 'Roster'
  return 'Home'
}

export function AiAssistantWidget() {
  const { canUseAssistant, user } = useDemoSession()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<AssistantChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement | null>(null)
  const welcomedRef = useRef(false)

  const pageLabel = useMemo(() => pageLabelFromPath(location.pathname), [location.pathname])

  useEffect(() => {
    if (!open || welcomedRef.current) return
    welcomedRef.current = true
    setMessages([{ role: 'assistant', content: buildAnalystWelcome(user?.name, pageLabel) }])
  }, [open, pageLabel, user?.name])

  useEffect(() => {
    if (!listRef.current) return
    listRef.current.scrollTop = listRef.current.scrollHeight
  }, [messages, loading, open])

  const send = useCallback(
    async (text: string) => {
      const question = text.trim()
      if (!question || loading) return
      setError('')
      setLoading(true)

      const prior = messages.length
        ? messages
        : [{ role: 'assistant' as const, content: buildAnalystWelcome(user?.name, pageLabel) }]
      const nextMessages: AssistantChatMessage[] = [...prior, { role: 'user', content: question }]
      setMessages(nextMessages)
      setInput('')

      try {
        const reply = await sendAssistantMessage({
          messages: nextMessages,
          context: buildAssistantContext(pageLabel),
          page: pageLabel,
          executiveName: user?.name,
          accessLevel: user?.accessLevel ?? null,
          aiAssistantApproved: user?.aiAssistantApproved,
        })
        setMessages((prev) => [...prev, { role: 'assistant', content: reply }])
      } catch (err) {
        const detail = err instanceof Error ? err.message : 'Assistant request failed.'
        setError(detail)
        setMessages((prev) => [...prev, { role: 'assistant', content: detail }])
      } finally {
        setLoading(false)
      }
    },
    [loading, messages, pageLabel, user?.accessLevel, user?.aiAssistantApproved, user?.name],
  )

  if (!canUseAssistant) return null

  const execName = executiveFirstName(user?.name)

  return (
    <>
      <button
        type="button"
        className={`ai-analyst-fab${open ? ' ai-analyst-fab--open' : ''}`}
        aria-expanded={open}
        aria-controls="ai-analyst-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <AssistantAvatar size="sm" />
        <span className="ai-analyst-fab__label">
          <strong>{open ? 'Close' : ASSISTANT.name}</strong>
        </span>
      </button>

      {open ? (
        <section id="ai-analyst-panel" className="ai-analyst-panel" aria-label="AI Assistant">
          <header className="ai-analyst-panel__head">
            <div className="ai-analyst-panel__agent">
              <AssistantAvatar size="lg" />
              <div>
                <h2 className="ai-analyst-panel__name">{ASSISTANT.name}</h2>
                <p className="ai-analyst-panel__role">{ASSISTANT.role}</p>
              </div>
            </div>
            <button type="button" className="ai-analyst-panel__close" onClick={() => setOpen(false)} aria-label="Close assistant">
              ×
            </button>
          </header>

          <div className="ai-analyst-panel__context">
            <span>Supporting {execName}</span>
            <span className="ai-analyst-panel__context-sep">·</span>
            <span>{pageLabel} view</span>
            <span className="ai-analyst-panel__context-sep">·</span>
            <span className="ai-analyst-panel__context-live">All modules connected</span>
          </div>

          <div ref={listRef} className="ai-analyst-panel__messages" aria-live="polite">
            {messages.map((message, index) => (
              <MessageThread key={`${message.role}-${index}`} message={message} />
            ))}
            {loading ? <TypingIndicator /> : null}
          </div>

          {error ? <p className="ai-analyst-panel__error">{error}</p> : null}

          <div className="ai-analyst-panel__prompts">
            <p className="ai-analyst-panel__prompts-label">Quick asks</p>
            <div className="ai-analyst-panel__prompts-row">
              {ASSISTANT_QUICK_PROMPTS.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className="ai-analyst-prompt"
                  disabled={loading}
                  onClick={() => void send(item.prompt)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          <form
            className="ai-analyst-panel__form"
            onSubmit={(event) => {
              event.preventDefault()
              void send(input)
            }}
          >
            <input
              className="ai-analyst-panel__input"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder={`Ask ${ASSISTANT.name} about your plans…`}
              disabled={loading}
            />
            <button type="submit" className="ai-analyst-panel__send" disabled={loading || !input.trim()}>
              Send
            </button>
          </form>

          <footer className="ai-analyst-panel__footer">
            {ASSISTANT.name} · Answers from your workspace data only
          </footer>
        </section>
      ) : null}
    </>
  )
}
