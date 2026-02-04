import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'

import { ApiClient, type StatusResponse } from './api'

interface RocamContextType {
  apiClient: ApiClient | null
  statusPollingError: Error | null
  status: StatusResponse | null
}

const RocamContext = createContext<RocamContextType | undefined>(undefined)

interface RocamProviderProps {
  children: ReactNode
}

export function RocamProvider({ children }: RocamProviderProps) {
  const [apiClient, setApiClient] = useState<ApiClient | null>(null)
  const [error, setError] = useState<Error | null>(null)
  const [status, setStatus] = useState<StatusResponse | null>(null)

  // Initialize API client
  useEffect(() => {
    let isMounted = true

    async function initializeApiClient() {
      try {
        setError(null)
        const client = await ApiClient.createAutomatic()

        if (isMounted) {
          setApiClient(client)
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err : new Error(String(err)))
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
        setError(null)
      } catch {
        // ignore malformed messages
      }
    }

    es.onerror = () => {
      setError(new Error('Status stream connection error'))
    }

    return () => {
      es.close()
    }
  }, [apiClient])

  const value: RocamContextType = {
    apiClient,
    statusPollingError: error,
    status,
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
