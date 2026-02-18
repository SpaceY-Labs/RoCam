import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Navbar as HeroUINavbar,
  NavbarContent,
  NavbarItem,
} from '@heroui/navbar'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/dropdown'
import { link as linkStyles } from '@heroui/theme'
import clsx from 'clsx'
import { Button } from '@heroui/button'
import {
  IconBug,
  IconCancel,
  IconMaximize,
  IconMaximizeOff,
} from '@tabler/icons-react'
import { Trans, useLingui } from '@lingui/react/macro'
import type { Selection } from '@react-types/shared'

import { ConfigurationMenu } from './ConfigurationMenu'

const DEV_SHOW_LOGS_STORAGE_KEY = 'app-developer-show-logs'
const DEV_MODE_EVENT = 'developer-mode-change'

export const Navbar = () => {
  const { t } = useLingui()
  const location = useLocation()
  const isControlPage = location.pathname === '/'
  const [showLogs, setShowLogs] = useState(false)

  useEffect(() => {
    const enabled = localStorage.getItem(DEV_SHOW_LOGS_STORAGE_KEY) === 'true'
    setShowLogs(enabled)
    document.body.dataset.developerMode = enabled ? 'true' : 'false'
  }, [])

  const handleDeveloperSelectionChange = (keys: Selection) => {
    if (keys === 'all') return
    const nextShowLogs = keys.has('show_logs')
    setShowLogs(nextShowLogs)
    localStorage.setItem(DEV_SHOW_LOGS_STORAGE_KEY, String(nextShowLogs))
    document.body.dataset.developerMode = nextShowLogs ? 'true' : 'false'
    window.dispatchEvent(new Event(DEV_MODE_EVENT))
  }

  return (
    <HeroUINavbar
      classNames={{
        base: isControlPage ? 'bg-transparent backdrop-filter-none' : undefined,
        wrapper: 'px-4',
      }}
      isBlurred={false}
      maxWidth="full"
    >
      <NavbarContent justify="start">
        <img alt={t`RoCam`} className="h-8" src="/logo.png" />

        <div className="flex gap-4 justify-start ml-2">
          <NavbarItem>
            <NavLink
              className={({ isActive }: { isActive: boolean }) =>
                clsx(
                  linkStyles({ color: 'foreground' }),
                  isActive ? 'font-bold' : 'text-gray-500'
                )
              }
              to={'/'}
            >
              <Trans>Control</Trans>
            </NavLink>
          </NavbarItem>
          <NavbarItem>
            <NavLink
              className={({ isActive }: { isActive: boolean }) =>
                clsx(
                  linkStyles({ color: 'foreground' }),
                  isActive ? 'font-bold' : 'text-gray-500'
                )
              }
              to={'/recordings'}
            >
              <Trans>Recordings</Trans>
            </NavLink>
          </NavbarItem>
        </div>
      </NavbarContent>
      <NavbarContent justify="end">
        <ConfigurationMenu />
        <Dropdown closeOnSelect={false}>
          <DropdownTrigger>
            <Button
              color={showLogs ? 'warning' : 'default'}
              radius="sm"
              startContent={<IconBug />}
              variant={showLogs ? 'solid' : 'bordered'}
            >
              <Trans>Developer Mode</Trans>
            </Button>
          </DropdownTrigger>
          <DropdownMenu
            aria-label={t`Developer Mode`}
            selectedKeys={showLogs ? new Set(['show_logs']) : new Set()}
            selectionMode="multiple"
            onSelectionChange={handleDeveloperSelectionChange}
          >
            <DropdownItem key="show_logs">
              <Trans>Show Logs</Trans>
            </DropdownItem>
          </DropdownMenu>
        </Dropdown>
        <Button
          radius="sm"
          startContent={
            document.fullscreenElement ? <IconMaximizeOff /> : <IconMaximize />
          }
          variant="bordered"
          onPress={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen()
            } else {
              document.documentElement.requestFullscreen()
            }
          }}
        >
          {document.fullscreenElement ? (
            <Trans>Exit Fullscreen</Trans>
          ) : (
            <Trans>Fullscreen</Trans>
          )}
        </Button>
        <Button
          color="danger"
          radius="sm"
          startContent={<IconCancel />}
          variant="bordered"
          onPress={() => {
            alert(t`Not implemented`)
          }}
        >
          <Trans>Emergency Stop</Trans>
        </Button>
      </NavbarContent>
    </HeroUINavbar>
  )
}
