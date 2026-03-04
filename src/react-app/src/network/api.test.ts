/**
 * Unit tests for src/network/api.ts
 *
 * Covers:
 *   - ApiError class construction
 *   - ApiClient URL helpers (pure methods)
 *   - ApiClient.createAutomatic() probe logic
 *   - All ApiClient request methods (manualMove, arm/disarm, recording CRUD)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ApiError, ApiClient } from './api'

// ---------------------------------------------------------------------------
// ApiError
// ---------------------------------------------------------------------------
describe('ApiError', () => {
  it('stores status code', () => {
    const err = new ApiError(404, 'Not Found')
    expect(err.status).toBe(404)
  })

  it('stores message', () => {
    const err = new ApiError(500, 'Internal Server Error')
    expect(err.message).toBe('Internal Server Error')
  })

  it('is an instance of Error', () => {
    const err = new ApiError(400, 'Bad Request')
    expect(err).toBeInstanceOf(Error)
  })
})

// ---------------------------------------------------------------------------
// ApiClient URL helpers (pure methods)
// ---------------------------------------------------------------------------
describe('ApiClient URL helpers', () => {
  const client = new ApiClient('http://localhost:5000')

  it('getStatusStreamUrl returns correct URL', () => {
    expect(client.getStatusStreamUrl()).toBe('http://localhost:5000/api/status')
  })

  it('getGenerate204Url returns correct URL', () => {
    expect(client.getGenerate204Url()).toBe(
      'http://localhost:5000/api/generate_204'
    )
  })

  it('getPreviewStabilizedUrl includes recording id', () => {
    expect(client.getPreviewStabilizedUrl('abc123')).toContain('abc123')
    expect(client.getPreviewStabilizedUrl('abc123')).toContain(
      'preview-stabilized'
    )
  })

  it('getDownloadStabilizedUrl includes recording id', () => {
    expect(client.getDownloadStabilizedUrl('xyz789')).toContain('xyz789')
    expect(client.getDownloadStabilizedUrl('xyz789')).toContain(
      'download-stabilized'
    )
  })

  it('default baseUrl is empty string', () => {
    const defaultClient = new ApiClient()
    expect(defaultClient.getStatusStreamUrl()).toBe('/api/status')
  })
})

// ---------------------------------------------------------------------------
// ApiClient.createAutomatic()
// ---------------------------------------------------------------------------
describe('ApiClient.createAutomatic', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('returns client when first URL responds 204', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 204 }))
    const client = await ApiClient.createAutomatic()
    expect(client).toBeInstanceOf(ApiClient)
    vi.unstubAllGlobals()
  })

  it('falls through to next URL when first fails', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) throw new Error('connection refused')
        return Promise.resolve({ status: 204 })
      })
    )
    const client = await ApiClient.createAutomatic()
    expect(client).toBeInstanceOf(ApiClient)
    vi.unstubAllGlobals()
  })

  it('throws when all URLs fail', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('no network')))
    await expect(ApiClient.createAutomatic()).rejects.toThrow(
      'Failed to connect'
    )
    vi.unstubAllGlobals()
  })

  it('skips URL with non-204 status', async () => {
    let callCount = 0
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.resolve({ status: 200 })
        return Promise.resolve({ status: 204 })
      })
    )
    const client = await ApiClient.createAutomatic()
    expect(client).toBeInstanceOf(ApiClient)
    vi.unstubAllGlobals()
  })
})

// ---------------------------------------------------------------------------
// ApiClient request methods
// ---------------------------------------------------------------------------

function makeFetchOk(body: unknown = {}) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => body,
  })
}

function makeFetchError(status: number, body: unknown = { error: 'Oops' }) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    statusText: 'Error',
    json: async () => body,
  })
}

describe('ApiClient request methods', () => {
  let client: ApiClient

  beforeEach(() => {
    client = new ApiClient('http://localhost')
    vi.restoreAllMocks()
  })

  it('manualMove sends POST with direction', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.manualMove('up')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/manual_move')
    expect(opts.method).toBe('POST')
    expect(JSON.parse(opts.body)).toEqual({ direction: 'up' })
    vi.unstubAllGlobals()
  })

  it('manualMoveTo sends tilt and pan', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.manualMoveTo(30, -10)
    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).toEqual({ tilt: 30, pan: -10 })
    vi.unstubAllGlobals()
  })

  it('arm sends POST to /api/arm', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.arm()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/arm')
    vi.unstubAllGlobals()
  })

  it('disarm sends POST to /api/disarm', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.disarm()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/disarm')
    vi.unstubAllGlobals()
  })

  it('startRecording sends POST to /api/recordings/start', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.startRecording()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/recordings/start')
    vi.unstubAllGlobals()
  })

  it('stopRecording sends POST to /api/recordings/stop', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.stopRecording()
    const [url] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/recordings/stop')
    vi.unstubAllGlobals()
  })

  it('listRecordings returns recordings array', async () => {
    const recordings = [
      {
        id: 'r1',
        name: 'Rec1',
        start_timestamp_ms: null,
        duration_ms: null,
        size_bytes: 0,
      },
    ]
    const fetchMock = makeFetchOk({ recordings })
    vi.stubGlobal('fetch', fetchMock)
    const result = await client.listRecordings()
    expect(result.recordings).toEqual(recordings)
    vi.unstubAllGlobals()
  })

  it('renameRecording sends PATCH with new_name', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.renameRecording('rec1', 'New Name')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/recordings/rec1')
    expect(opts.method).toBe('PATCH')
    expect(JSON.parse(opts.body)).toEqual({ new_name: 'New Name' })
    vi.unstubAllGlobals()
  })

  it('deleteRecording sends DELETE', async () => {
    const fetchMock = makeFetchOk({})
    vi.stubGlobal('fetch', fetchMock)
    await client.deleteRecording('rec1')
    const [url, opts] = fetchMock.mock.calls[0]
    expect(url).toContain('/api/recordings/rec1')
    expect(opts.method).toBe('DELETE')
    vi.unstubAllGlobals()
  })

  it('throws ApiError on non-ok response', async () => {
    const fetchMock = makeFetchError(404)
    vi.stubGlobal('fetch', fetchMock)
    await expect(client.arm()).rejects.toBeInstanceOf(ApiError)
    vi.unstubAllGlobals()
  })

  it('ApiError status matches response status', async () => {
    const fetchMock = makeFetchError(403)
    vi.stubGlobal('fetch', fetchMock)
    try {
      await client.arm()
    } catch (e) {
      expect((e as ApiError).status).toBe(403)
    }
    vi.unstubAllGlobals()
  })

  it('uses statusText when response body has no error field', async () => {
    // data.error is undefined → falls through to response.statusText
    const fetchMock = makeFetchError(500, {})
    vi.stubGlobal('fetch', fetchMock)
    try {
      await client.arm()
    } catch (e) {
      expect((e as ApiError).message).toBe('Error') // from statusText
    }
    vi.unstubAllGlobals()
  })

  it('uses "Request failed" when both data.error and statusText are empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        statusText: '',
        json: async () => ({}),
      })
    )
    try {
      await client.arm()
    } catch (e) {
      expect((e as ApiError).message).toBe('Request failed')
    }
    vi.unstubAllGlobals()
  })
})
