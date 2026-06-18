import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { MessageCircle, Search, Send, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { authClient } from '#/lib/auth-client'

type ConversationMessage = {
  id: string
  conversationId: string
  schoolName: string
  channel: 'ai' | 'staff'
  senderType: 'client' | 'staff' | 'ai' | 'system'
  senderUserId: string | null
  senderEmail: string | null
  senderName: string | null
  body: string
  createdAt: string
}

type ConversationView = {
  conversationId: string
  schoolName: string
  channel: 'ai' | 'staff'
  messages: ConversationMessage[]
  unreadCount: number
  lastMessageCreatedAt: string | null
}

type StaffConversationSummary = {
  schoolName: string
  conversationId: string
  unreadCount: number
  lastMessage: ConversationMessage | null
}

async function fetchStaffSchools() {
  const response = await fetch('/api/conversations/schools')
  const data = await response.json() as { schools?: StaffConversationSummary[]; error?: string }
  if (!response.ok) throw new Error(data.error || 'Unable to load staff conversations.')
  return data.schools ?? []
}

async function fetchStaffConversation(schoolName: string) {
  const response = await fetch(`/api/conversations?schoolName=${encodeURIComponent(schoolName)}&channel=staff`)
  const data = await response.json() as ConversationView | { error?: string }
  if (!response.ok) throw new Error('error' in data && data.error ? data.error : 'Unable to load messages.')
  return data as ConversationView
}

async function markStaffConversationRead(schoolName: string) {
  await fetch('/api/conversations/read', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ schoolName, channel: 'staff' }),
  })
}

export default function StaffMessenger() {
  const queryClient = useQueryClient()
  const { data: session } = authClient.useSession()
  const role = session?.user ? (session.user as any).role : null
  const isStaff = role === 'admin' || role === 'vertex_user'
  const [isOpen, setIsOpen] = useState(false)
  const [selectedSchoolName, setSelectedSchoolName] = useState('')
  const [search, setSearch] = useState('')
  const [messageInput, setMessageInput] = useState('')
  const [sendError, setSendError] = useState('')
  const [sending, setSending] = useState(false)
  const reconnectTimersRef = useRef<Array<ReturnType<typeof setTimeout>>>([])
  const messagesBottomRef = useRef<HTMLDivElement>(null)

  const { data: schools = [] } = useQuery({
    queryKey: ['staff-conversation-schools'],
    queryFn: fetchStaffSchools,
    enabled: isStaff,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })

  const filteredSchools = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (!needle) return schools
    return schools.filter((school) => school.schoolName.toLowerCase().includes(needle))
  }, [schools, search])

  const totalUnreadCount = schools.reduce((total, school) => total + school.unreadCount, 0)
  const selectedSchool = selectedSchoolName || filteredSchools[0]?.schoolName || schools[0]?.schoolName || ''

  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ['school-conversation', selectedSchool, 'staff'],
    queryFn: () => fetchStaffConversation(selectedSchool),
    enabled: isStaff && isOpen && Boolean(selectedSchool),
  })

  useEffect(() => {
    if (!selectedSchoolName && schools[0]) setSelectedSchoolName(schools[0].schoolName)
  }, [schools, selectedSchoolName])

  useEffect(() => {
    if (!isStaff || schools.length === 0) return

    let closedByEffect = false
    const sockets: WebSocket[] = []
    reconnectTimersRef.current.forEach(clearTimeout)
    reconnectTimersRef.current = []

    const connectSchool = (schoolName: string, attempt = 0) => {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(`${protocol}//${window.location.host}/api/conversations/ws?schoolName=${encodeURIComponent(schoolName)}`)
      sockets.push(socket)

      socket.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data)
          if (payload?.schoolName !== schoolName || payload?.channel !== 'staff') return
          queryClient.invalidateQueries({ queryKey: ['staff-conversation-schools'] })
          queryClient.invalidateQueries({ queryKey: ['school-conversation', schoolName, 'staff'] })
        } catch {
          // Ignore non-JSON keepalive frames.
        }
      }

      socket.onclose = () => {
        if (closedByEffect) return
        const timer = setTimeout(() => connectSchool(schoolName, attempt + 1), Math.min(1000 * (attempt + 1), 5000))
        reconnectTimersRef.current.push(timer)
      }
    }

    schools.forEach((school) => connectSchool(school.schoolName))

    return () => {
      closedByEffect = true
      reconnectTimersRef.current.forEach(clearTimeout)
      reconnectTimersRef.current = []
      sockets.forEach((socket) => socket.close())
    }
  }, [isStaff, queryClient, schools])

  useEffect(() => {
    messagesBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [conversation?.messages.length, selectedSchool])

  useEffect(() => {
    if (!isOpen || !selectedSchool) return
    void markStaffConversationRead(selectedSchool)
      .then(() => {
        queryClient.invalidateQueries({ queryKey: ['staff-conversation-schools'] })
        queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedSchool, 'staff'] })
      })
      .catch(() => {})
  }, [conversation?.lastMessageCreatedAt, conversation?.messages.length, isOpen, queryClient, selectedSchool])

  const sendMessage = async (event: FormEvent) => {
    event.preventDefault()
    if (!selectedSchool || !messageInput.trim()) return

    const body = messageInput.trim()
    setMessageInput('')
    setSendError('')
    setSending(true)

    try {
      const response = await fetch('/api/conversations/messages', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schoolName: selectedSchool, body }),
      })
      const data = await response.json() as { error?: string }
      if (!response.ok) throw new Error(data.error || 'Unable to send message.')
      await queryClient.invalidateQueries({ queryKey: ['staff-conversation-schools'] })
      await queryClient.invalidateQueries({ queryKey: ['school-conversation', selectedSchool, 'staff'] })
    } catch (err: any) {
      setMessageInput(body)
      setSendError(err?.message || 'Unable to send message.')
    } finally {
      setSending(false)
    }
  }

  if (!isStaff) return null

  return (
    <div className={isOpen
      ? 'fixed inset-x-2 bottom-[5.75rem] z-50 flex flex-col items-end sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[720px]'
      : 'fixed right-0 bottom-28 z-50'
    }>
      {!isOpen && (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className={`relative inline-flex min-h-32 w-12 items-center justify-center rounded-l-xl border border-r-0 py-4 text-sm font-bold shadow-2xl transition-transform duration-200 hover:-translate-x-1 focus-visible:-translate-x-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--vertex-blue)] focus-visible:ring-offset-2 ${totalUnreadCount > 0 ? 'border-[var(--vertex-gold)] bg-amber-50 text-amber-900 ring-2 ring-[var(--vertex-gold)] ring-offset-2' : 'border-[var(--vertex-blue)] bg-white text-[var(--vertex-blue)]'}`}
          aria-label="Open staff messages"
        >
          <span className="flex rotate-180 items-center gap-2 [writing-mode:vertical-rl]">
            <MessageCircle size={16} className="text-[var(--vertex-gold)]" aria-hidden="true" />
            <span>Staff IM</span>
            {totalUnreadCount > 0 && (
              <span className="rounded-full bg-[var(--vertex-gold)] px-2 py-0.5 text-[9px] font-black uppercase tracking-wide text-white">
                New
              </span>
            )}
          </span>
          {totalUnreadCount > 0 && (
            <span className="absolute -left-3 top-2 inline-flex min-w-7 items-center justify-center rounded-full bg-red-600 px-2 py-1 text-[10px] font-black text-white shadow-lg ring-2 ring-white">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--vertex-gold)] opacity-55" aria-hidden="true" />
              <span className="relative">{totalUnreadCount}</span>
            </span>
          )}
        </button>
      )}

      {isOpen && (
        <aside className="chat-popout-enter grid h-[min(680px,calc(100vh-6rem))] w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-2xl md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col border-b border-[var(--line)] bg-[var(--foam)] md:border-b-0 md:border-r">
            <div className="flex items-center justify-between border-b border-[var(--line)] bg-[var(--vertex-blue)] p-4 text-white">
              <div>
                <p className="text-sm font-black">Staff IM</p>
                <p className="text-[9px] font-bold uppercase tracking-wider text-white/70">Client messages</p>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white"
                aria-label="Close staff messages"
              >
                <X size={16} aria-hidden="true" />
              </button>
            </div>

            <label className="flex items-center gap-2 border-b border-[var(--line)] bg-white px-3 py-2 text-xs text-[var(--sea-ink-soft)]">
              <Search size={14} aria-hidden="true" />
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Find school..."
                className="min-w-0 flex-1 bg-transparent font-semibold outline-none"
              />
            </label>

            <div className="max-h-44 overflow-y-auto p-2 md:max-h-none md:flex-1">
              {filteredSchools.length === 0 ? (
                <p className="p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">No school conversations found.</p>
              ) : filteredSchools.map((school) => (
                <button
                  key={school.schoolName}
                  type="button"
                  onClick={() => {
                    setSelectedSchoolName(school.schoolName)
                    setSendError('')
                  }}
                  className={`w-full rounded-lg p-2 text-left transition ${selectedSchool === school.schoolName ? 'bg-white text-[var(--vertex-blue)] shadow-sm' : 'text-[var(--sea-ink)] hover:bg-white/75'}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-xs font-black">{school.schoolName}</span>
                    {school.unreadCount > 0 && (
                      <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[9px] font-black text-white">
                        {school.unreadCount}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 truncate text-[10px] font-semibold text-[var(--sea-ink-soft)]">
                    {school.lastMessage?.body || 'No messages yet'}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="flex min-h-0 flex-col">
            <div className="border-b border-[var(--line)] bg-white p-4">
              <p className="text-xs font-extrabold uppercase tracking-wider text-[var(--vertex-gold)]">Conversation</p>
              <h2 className="mt-1 truncate text-base font-black text-[var(--vertex-blue)]">{selectedSchool || 'Select a school'}</h2>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-[var(--foam)] p-4">
              {conversationLoading ? (
                <div className="rounded-2xl border border-[var(--line)] bg-white p-3 text-xs font-semibold text-[var(--sea-ink-soft)]">Loading messages...</div>
              ) : !selectedSchool ? (
                <div className="rounded-2xl border border-[var(--line)] bg-white p-3 text-sm font-semibold text-[var(--sea-ink)]">Choose a school to start messaging.</div>
              ) : (conversation?.messages.length ?? 0) === 0 ? (
                <div className="rounded-2xl border border-[var(--line)] bg-white p-3 text-sm font-semibold text-[var(--sea-ink)]">No messages yet. Send the first note to this school.</div>
              ) : conversation?.messages.map((message) => {
                const isMine = message.senderUserId === session?.user?.id
                const label = message.senderName || message.senderEmail || (message.senderType === 'staff' ? 'Vertex Team' : 'Client')
                return (
                  <div key={message.id} className={`flex max-w-[85%] flex-col ${isMine ? 'ml-auto items-end' : 'items-start'}`}>
                    <div className={`rounded-2xl p-3 text-xs leading-relaxed ${isMine ? 'rounded-br-none bg-[var(--vertex-blue)] text-white' : 'rounded-bl-none border border-[var(--line)] bg-white text-[var(--sea-ink)] shadow-xxs'}`}>
                      {message.body}
                    </div>
                    <span className="mt-1 px-1 text-[9px] font-semibold text-[var(--sea-ink-soft)]">
                      {label} · {new Date(message.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )
              })}
              {sendError && (
                <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-xs font-semibold text-red-700">{sendError}</div>
              )}
              <div ref={messagesBottomRef} />
            </div>

            <form onSubmit={sendMessage} className="flex gap-2 border-t border-[var(--line)] bg-white p-3">
              <input
                type="text"
                value={messageInput}
                onChange={(event) => setMessageInput(event.target.value)}
                placeholder={selectedSchool ? `Message ${selectedSchool}...` : 'Select a school first'}
                disabled={!selectedSchool}
                className="min-w-0 flex-1 rounded-xl border border-[var(--chip-line)] bg-neutral-50 px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[var(--vertex-blue)] disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={!selectedSchool || sending || !messageInput.trim()}
                className="flex items-center justify-center rounded-xl bg-[var(--vertex-blue)] p-2 text-white transition hover:bg-[var(--lagoon-deep)] disabled:opacity-45"
                aria-label="Send staff message"
              >
                <Send size={16} aria-hidden="true" />
              </button>
            </form>
          </div>
        </aside>
      )}
    </div>
  )
}
