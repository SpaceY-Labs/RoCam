import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
} from '@heroui/dropdown'
import { Button } from '@heroui/button'
import { useAtom } from 'jotai'
import { IconSettings } from '@tabler/icons-react'
import { Trans } from '@lingui/react/macro'
import { useLingui } from '@lingui/react/macro'
import { Key } from 'react'

import {
  languageAtom,
  temperatureUnitAtom,
  type Language,
  type TemperatureUnit,
} from '@/store/languageAtom'

const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'EN' },
  { key: 'fr', label: 'FR' },
]

const TEMPERATURE_UNITS: { key: TemperatureUnit; label: string }[] = [
  { key: 'celsius', label: '°C (Celsius)' },
  { key: 'fahrenheit', label: '°F (Fahrenheit)' },
]

export function ConfigurationMenu() {
  const { t } = useLingui()
  const [language, setLanguage] = useAtom(languageAtom)
  const [temperatureUnit, setTemperatureUnit] = useAtom(temperatureUnitAtom)

  const handleAction = (key: Key) => {
    const keyStr = String(key)

    // Check language
    if (keyStr === 'en' || keyStr === 'fr') {
      setLanguage(keyStr as Language)

      return
    }

    // Check temperature
    if (keyStr === 'celsius' || keyStr === 'fahrenheit') {
      setTemperatureUnit(keyStr as TemperatureUnit)

      return
    }
  }

  return (
    <>
      <Dropdown>
        <DropdownTrigger>
          <Button
            radius="sm"
            startContent={<IconSettings />}
            variant="bordered"
          >
            <Trans>Configuration</Trans>
          </Button>
        </DropdownTrigger>
        <DropdownMenu
          aria-label={t`Configuration`}
          classNames={{
            base: 'max-h-[400px] overflow-y-auto',
          }}
          selectedKeys={[language, temperatureUnit]}
          selectionMode="multiple"
          onAction={handleAction}
        >
          <DropdownSection title={t`Language`}>
            {LANGUAGES.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>

          <DropdownSection title={t`Temperature`}>
            {TEMPERATURE_UNITS.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </>
  )
}
