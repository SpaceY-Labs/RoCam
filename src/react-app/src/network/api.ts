/**
 * Author: Zifan Si
 * Date: 2025-11-15
 * Purpose: Defines backend API types and the frontend API client.
 */
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
  focal_length_mm: number
  focal_length_min_mm: number
  focal_length_max_mm: number
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

export type ApiResponse<T = Record<string, unknown>> = T

export class ApiError extends Error {
  status: number

  /**
   * Creates an error wrapper for failed backend API responses.
   *
   * @param status HTTP status code returned by the backend.
   * @param message Human-readable error message derived from the response.
   */
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

  /**
   * Creates an API client bound to a specific backend base URL.
   *
   * @param baseUrl Backend base URL prefix used for all requests.
   */
  constructor(baseUrl: string = '') {
    this.baseUrl = baseUrl
  }

  /**
   * Automatically creates an ApiClient by trying different base URLs in order.
   * Probes each URL with GET /api/generate_204 and returns the first working instance.
   *
   * @returns Promise resolving to an ApiClient instance with a working base URL.
   * @throws Error if none of the candidate base URLs are accessible.
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

  /**
   * Returns the URL used for the live status event stream.
   *
   * @returns Absolute or relative URL for `GET /api/status`.
   */
  getStatusStreamUrl(): string {
    return `${this.baseUrl}/api/status`
  }

  /**
   * Returns the URL used for the backend logs event stream.
   *
   * @returns Absolute or relative URL for `GET /api/logs`.
   */
  getLogsStreamUrl(): string {
    return `${this.baseUrl}/api/logs`
  }

  /**
   * Returns the URL used to probe backend availability.
   *
   * @returns Absolute or relative URL for `GET /api/generate_204`.
   */
  getGenerate204Url(): string {
    return `${this.baseUrl}/api/generate_204`
  }

  /**
   * Returns the preview URL for a stabilized recording.
   *
   * @param recordingId Identifier of the recording to preview.
   * @returns Absolute or relative URL for the stabilized preview stream.
   */
  getPreviewStabilizedUrl(recordingId: string): string {
    return `${this.baseUrl}/api/recordings/${recordingId}/preview-stabilized`
  }

  /**
   * Returns the download URL for a stabilized recording.
   *
   * @param recordingId Identifier of the recording to download.
   * @returns Absolute or relative URL for the stabilized recording asset.
   */
  getDownloadStabilizedUrl(recordingId: string): string {
    return `${this.baseUrl}/api/recordings/${recordingId}/download-stabilized`
  }

  /**
   * Sends a JSON request and normalizes failed responses into `ApiError`.
   *
   * @param method HTTP method used for the backend request.
   * @param endpoint Backend endpoint relative to the configured base URL.
   * @param body Optional JSON body sent with the request.
   * @returns Parsed JSON payload returned by the backend.
   */
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
   * Sends a manual movement command to the backend.
   *
   * @param direction Direction that the gimbal should move.
   * @returns Promise resolving to the backend response payload.
   */
  async manualMove(
    direction: 'up' | 'down' | 'left' | 'right'
  ): Promise<ApiResponse> {
    const body = { direction }

    return this.requestJson<ApiResponse>('POST', '/api/manual_move', body)
  }

  /**
   * Sends an absolute pan and tilt target to the backend.
   *
   * @param tilt Tilt angle that the gimbal should move to.
   * @param pan Pan angle that the gimbal should move to.
   * @returns Promise resolving to the backend response payload.
   */
  async manualMoveTo(tilt: number, pan: number): Promise<ApiResponse> {
    const body = { tilt, pan }

    return this.requestJson<ApiResponse>('POST', '/api/manual_move_to', body)
  }

  /**
   * Arms the tracking system.
   *
   * @returns Promise resolving to the backend response payload.
   */
  async arm(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/arm')
  }

  /**
   * Disarms the tracking system.
   *
   * @returns Promise resolving to the backend response payload.
   */
  async disarm(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/disarm')
  }

  /**
   * Starts backend-side recording for the active session.
   *
   * @returns Promise resolving to the backend response payload.
   */
  async startRecording(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/recordings/start')
  }

  /**
   * Stops the current backend recording session.
   *
   * @returns Promise resolving to the backend response payload.
   */
  async stopRecording(): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/recordings/stop')
  }

  /**
   * Fetches the available recording list for the recordings page.
   *
   * @returns Promise resolving to the current recording collection.
   */
  async listRecordings(): Promise<RecordingListResponse> {
    return this.requestJson<RecordingListResponse>('GET', '/api/recordings')
  }

  /**
   * Renames a recording through the backend API.
   *
   * @param recordingId Identifier of the recording to rename.
   * @param newName New recording name requested by the user.
   * @returns Promise resolving to the backend response payload.
   */
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

  /**
   * Updates the lens focal length used by camera controls.
   *
   * @param focalLengthMm New focal length in millimeters.
   * @returns Promise resolving to the backend response payload.
   */
  async setFocalLength(focalLengthMm: number): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>('POST', '/api/set_focal_length', {
      focal_length_mm: focalLengthMm,
    })
  }

  /**
   * Removes a recording from backend storage.
   *
   * @param recordingId Identifier of the recording to delete.
   * @returns Promise resolving to the backend response payload.
   */
  async deleteRecording(recordingId: string): Promise<ApiResponse> {
    return this.requestJson<ApiResponse>(
      'DELETE',
      `/api/recordings/${recordingId}`
    )
  }
}
