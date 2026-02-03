import { NavLink, useLocation } from 'react-router-dom'
import {
  Navbar as HeroUINavbar,
  NavbarContent,
  NavbarItem,
} from '@heroui/navbar'
import { link as linkStyles } from '@heroui/theme'
import clsx from 'clsx'
import { Button } from '@heroui/button'
import { IconCancel, IconMaximize, IconMaximizeOff } from '@tabler/icons-react'

export const Navbar = () => {
  const location = useLocation()
  const isControlPage = location.pathname === '/'

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
        <img alt="RoCam" className="h-8" src="/logo.png" />

        <div className="hidden lg:flex gap-4 justify-start ml-2">
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
              Control
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
              Recordings
            </NavLink>
          </NavbarItem>
        </div>
      </NavbarContent>
      <NavbarContent justify="end">
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
          {document.fullscreenElement ? 'Exit Fullscreen' : 'Fullscreen'}
        </Button>
        <Button
          color="danger"
          radius="sm"
          startContent={<IconCancel />}
          variant="bordered"
          onPress={() => {
            alert('Not implemented')
          }}
        >
          Emergency Stop
        </Button>
      </NavbarContent>
    </HeroUINavbar>
  )
}
