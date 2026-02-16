// API Types

export type BoundingBox = {
  conf: number
  left: number
  top: number
  width: number
  height: number
}

export type StatusResponse = {
  armed: boolean
  tilt: number
  pan: number
  preview: string | null
  bbox: BoundingBox | null
  average_fps: number
  cpu_utilization: number
  gpu_utilization: number
  core_temperature_celsius: number
  system_power_w: number
  memory_used_bytes: number
  memory_total_bytes: number
  disk_used_bytes: number
  disk_total_bytes: number
  recording_duration_left_s: number
  timestamp_ms: number
  is_recording: boolean
  longitude: number | null
  latitude: number | null
}

export type Recording = {
  id: string
  name: string
  start_timestamp_ms: number | null
  duration_ms: number | null
  size_bytes: number
}

export type RecordingListResponse = {
  recordings: Recording[]
}

export type LogEntry = {
  level: string
  name: string
  message: string
  created: number
}

export type ApiResponse<T = Record<string, unknown>> = T

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * API Client for communicating with the Flask backend
 */
export class ApiClient {
  private baseUrl: string

  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl
  }

  /**
   * Automatically creates an ApiClient by trying different base URLs in order.
   * Probes each URL with GET /api/generate_204 and returns the first working instance.
   * @returns Promise resolving to an ApiClient instance with a working base URL
   * @throws Error if none of the base URLs are accessible
   */
  static async createAutomatic(): Promise<ApiClient> {
    const baseUrls = ['', 'http://localhost:5000', 'http://100.117.52.117']

    for (const baseUrl of baseUrls) {
      const client = new ApiClient(baseUrl)

      try {
        const response = await fetch(client.getGenerate204Url(), {
          method: 'GET',
        })

        if (response.status === 204) return client
      } catch {
        // Continue to next URL if this one fails
        continue
      }
    }

    throw new Error(
      'Failed to connect to API. Tried base URLs: ' + baseUrls.join(', ')
    )
  }

  /** URL for the status SSE stream (GET /api/status). */
  getStatusStreamUrl(): string {
    return `${this.baseUrl}/api/status`
  }

  /** URL for the logs SSE stream (GET /api/logs). */
  getLogsStreamUrl(): string {
    return `${this.baseUrl}/api/logs`
  }

  /** URL for discovery probe (GET /api/generate_204). */
  getGenerate204Url(): string {
    return `${this.baseUrl}/api/generate_204`
  }

  getPreviewStabilizedUrl(recordingId: string): string {
    return `${this.baseUrl}/api/recordings/${recordingId}/preview-stabilized`
  }

  getDownloadStabilizedUrl(recordingId: string): string {
    return `${this.baseUrl}/api/recordings/${recordingId}/download-stabilized`
  }

  private async requestJson<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    endpoint: string,
    body?: Record<string, unknown>
  ): Promise<T> {
    const url = `${this.baseUrl}${endpoint}`
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json().catch(() => ({}))

    if (!response.ok) {
      const message =
        (data as { error?: string })?.error ||
        response.statusText ||
        'Request failed'

      throw new ApiError(response.status, message)
    }

    return data as T
  }

  /**
   * Sends a manual move command to the backend
   * @param direction - The direction to move
   * @returns Promise resolving to an empty response
   */
  async manualMove(
    direction: 'up' | 'down' | 'left' | 'right'
  ): Promise<ApiResponse> {
    const body = { direction }

    return this.requestJson<ApiResponse>('POST', '/api/manual_move', body)
  }

  /**
   * Sends a manual move to command to the backend
   * @param tilt - The tilt angle to move to
   * @param pan - The pan angle to move to
   * @returns Promise resolving to an empty response
   */
  async manualMoveTo(tilt: number, pan: number): Promise<ApiResponse> {
    const body = { tilt, pan }

    return this.requestJson<ApiResponse>('POST', '/api/manual_move_to', body)
  }

  /**
   * Arms the system
   * @returns Promise resolving to an empty response
   */
  async arm(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/arm')
  }

  /**
   * Disarms the system
   * @returns Promise resolving to an empty response
   */
  async disarm(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/disarm')
  }

  async startRecording(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/recordings/start')
  }

  async stopRecording(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/recordings/stop')
  }

  async listRecordings(): Promise<RecordingListResponse> {
    return this.requestJson<RecordingListResponse>('GET', '/api/recordings')
  }

  async renameRecording(
    recordingId: string,
    newName: string
  ): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>(
      'PATCH',
      `/api/recordings/${recordingId}`,
      {
        new_name: newName,
      }
    )
  }

  async deleteRecording(recordingId: string): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>(
      'DELETE',
      `/api/recordings/${recordingId}`
    )
  }
}
