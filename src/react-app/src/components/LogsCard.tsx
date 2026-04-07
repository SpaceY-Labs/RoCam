/**
 * Author: Zifan Si
 * Date: 2026-02-18
 * Purpose: Displays live backend logs in the control dashboard.
 */
import { Card, CardBody } from '@heroui/card'
import { Trans, useLingui } from '@lingui/react/macro'
import { useEffect, useRef } from 'react'

import { useRocam } from '@/network/rocamProvider'

/**
 * Displays the live backend log stream with auto-scroll behavior.
 *
 * @returns Card section containing the buffered backend log output.
 */
export function LogsCard() {
  const { t } = useLingui()
  const { logs } = useRocam()
  const scrollRef = useRef<HTMLDivElement>(null)
  // Track whether the user is already at the end before auto-scrolling new logs.
  const isAtBottomRef = useRef(true)

  /**
   * Tracks whether the user is currently viewing the newest log lines.
   *
   * @returns No return value.
   */
  const checkIsAtBottom = () => {
    const el = scrollRef.current

    if (!el) return
    isAtBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
  }

  useEffect(() => {
    const el = scrollRef.current

    if (!el) return

    if (isAtBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [logs])

  return (
    <Card radius="sm">
      <CardBody className="px-6 py-5 flex flex-col">
        <p className="text-xs font-semibold uppercase text-gray-800 tracking-widest">
          <Trans>Logs</Trans>
        </p>
        <div
          ref={scrollRef}
          className="mt-3 flex-1 rounded-md overflow-y-auto"
          onScroll={checkIsAtBottom}
        >
          {logs.length > 0 ? (
            logs.map((entry) => (
              <div
                key={entry.id}
                className={`font-mono text-xs leading-5 break-all ${levelColor(entry.level)}`}
              >
                [{formatTime(entry.timestamp)}] {entry.level} {entry.logger}:{' '}
                {entry.message}
              </div>
            ))
          ) : (
            <p className="text-xs text-gray-500">{t`Waiting for logs...`}</p>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

/**
 * Maps backend log levels to the color treatment used in the log viewer.
 *
 * @param level Backend log level string.
 * @returns Tailwind text color class used for the log line.
 */
function levelColor(level: string): string {
  switch (level.toUpperCase()) {
    case 'ERROR':
    case 'CRITICAL':
      return 'text-red-600'
    case 'WARN':
    case 'WARNING':
      return 'text-yellow-600'
    case 'DEBUG':
      return 'text-blue-500'
    default:
      return 'text-gray-700'
  }
}

/**
 * Formats log timestamps as local time for compact inline display.
 *
 * @param timestampMs Log timestamp in milliseconds.
 * @returns Localized time string for the log viewer.
 */
function formatTime(timestampMs: number): string {
  return new Date(timestampMs).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}
