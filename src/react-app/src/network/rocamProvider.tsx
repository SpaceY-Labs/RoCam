import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { addToast } from '@heroui/toast'
import { useLingui } from '@lingui/react/macro'

import { ApiClient, type StatusResponse } from './api'
import { getErrorMessage } from '@/utils'

export type LogEntry = {
  id: number
  timestamp: number
  level: string
  logger: string
  message: string
}

const MAX_LOG_ENTRIES = 1000

interface RocamContextType {
  apiClient: ApiClient | null
  status: StatusResponse | null
  logs: LogEntry[]
}

const RocamContext = createContext<RocamContextType | undefined>(undefined)

interface RocamProviderProps {
  children: ReactNode
}

export function RocamProvider({ children }: RocamProviderProps) {
  const { t } = useLingui()
  const [apiClient, setApiClient] = useState<ApiClient | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const nextLogIdRef = useRef(1)
  const logsErrorMessageRef = useRef<string | null>(null)

  // Initialize API client
  useEffect(() => {
    let isMounted = true

    async function initializeApiClient() {
      try {
        setErrorMessage(null)
        const client = await ApiClient.createAutomatic()

        if (isMounted) {
          setApiClient(client)
        }
      } catch (err) {
        if (isMounted) {
          setErrorMessage(getErrorMessage(err))
        }
      }
    }

    initializeApiClient()

    return () => {
      isMounted = false
    }
  }, [])

  // Subscribe to status SSE stream (30Hz from backend)
  useEffect(() => {
    if (!apiClient) return

    const url = apiClient.getStatusStreamUrl()
    const es = new EventSource(url)

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as StatusResponse

        setStatus(data)
        setErrorMessage(null)
      } catch {
        // ignore malformed messages
      }
    }

    es.onerror = () => {
      setErrorMessage('Status stream connection error')
    }

    return () => {
      es.close()
    }
  }, [apiClient])

  useEffect(() => {
    if (!errorMessage) return

    addToast({
      title: t`Failed to poll status`,
      description: errorMessage,
      color: 'danger',
    })
  }, [errorMessage, t])

  // Subscribe to logs SSE stream
  useEffect(() => {
    if (!apiClient) return

    const es = new EventSource(apiClient.getLogsStreamUrl())

    es.onmessage = (event) => {
      const entry = parseLogEvent(event.data, nextLogIdRef.current++)

      if (!entry) return

      logsErrorMessageRef.current = null
      setLogs((prev) => {
        const next = [...prev, entry]

        return next.length <= MAX_LOG_ENTRIES
          ? next
          : next.slice(next.length - MAX_LOG_ENTRIES)
      })
    }

    es.onerror = () => {
      const message = 'Logs stream connection error'

      if (logsErrorMessageRef.current === message) return

      logsErrorMessageRef.current = message
      addToast({
        title: t`Failed to stream logs`,
        description: t`Logs stream connection error`,
        color: 'danger',
      })
    }

    return () => {
      es.close()
    }
  }, [apiClient, t])

  const value: RocamContextType = {
    apiClient,
    status,
    logs,
  }

  return <RocamContext.Provider value={value}>{children}</RocamContext.Provider>
}

/**
 * Hook to access the API client from the Rocam context
 * @returns The API client, loading state, error state, and current status
 * @throws Error if used outside of RocamProvider
 */
export function useRocam() {
  const context = useContext(RocamContext)

  if (context === undefined) {
    throw new Error('useRocam must be used within a RocamProvider')
  }

  return context
}

function parseLogEvent(rawData: string, id: number): LogEntry | null {
  try {
    const data = JSON.parse(rawData) as {
      timestamp?: number
      level?: string
      logger?: string
      message?: string
    }

    if (typeof data.message !== 'string') return null

    return {
      id,
      timestamp: Number.isFinite(data.timestamp)
        ? (data.timestamp as number)
        : Date.now(),
      level: typeof data.level === 'string' ? data.level : 'INFO',
      logger: typeof data.logger === 'string' ? data.logger : 'backend',
      message: data.message,
    }
  } catch {
    return null
  }
}
