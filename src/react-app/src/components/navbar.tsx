import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import {
  Navbar as HeroUINavbar,
  NavbarContent,
  NavbarItem,
} from '@heroui/navbar'
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

import { ConfigurationMenu } from './ConfigurationMenu'

const DEV_MODE_STORAGE_KEY = 'app-developer-mode'
const DEV_MODE_EVENT = 'developer-mode-change'

export const Navbar = () => {
  const { t } = useLingui()
  const location = useLocation()
  const isControlPage = location.pathname === '/'
  const [isDeveloperMode, setIsDeveloperMode] = useState(false)

  useEffect(() => {
    const enabled = localStorage.getItem(DEV_MODE_STORAGE_KEY) === 'true'
    setIsDeveloperMode(enabled)
    document.body.dataset.developerMode = enabled ? 'true' : 'false'
  }, [])

  const handleToggleDeveloperMode = () => {
    const next = !isDeveloperMode
    setIsDeveloperMode(next)
    localStorage.setItem(DEV_MODE_STORAGE_KEY, String(next))
    document.body.dataset.developerMode = next ? 'true' : 'false'
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
        <Button
          color={isDeveloperMode ? 'warning' : 'default'}
          radius="sm"
          startContent={<IconBug />}
          variant={isDeveloperMode ? 'solid' : 'bordered'}
          onPress={handleToggleDeveloperMode}
        >
          <Trans>Developer Mode</Trans>
        </Button>
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
