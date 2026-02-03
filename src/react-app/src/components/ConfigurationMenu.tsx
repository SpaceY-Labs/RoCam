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
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import { Key } from 'react'

import {
  languageAtom,
  temperatureUnitAtom,
  speedUnitAtom,
  distanceUnitAtom,
  timeUnitAtom,
  type Language,
  type TemperatureUnit,
  type SpeedUnit,
  type DistanceUnit,
  type TimeUnit,
} from '@/store/languageAtom'

const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'EN' },
  { key: 'fr', label: 'FR' },
]

const TEMPERATURE_UNITS: { key: TemperatureUnit; label: string }[] = [
  { key: 'celsius', label: '°C (Celsius)' },
  { key: 'fahrenheit', label: '°F (Fahrenheit)' },
]

const SPEED_UNITS: { key: SpeedUnit; label: string }[] = [
  { key: 'kmh', label: 'km/h' },
  { key: 'mph', label: 'mph' },
  { key: 'ms', label: 'm/s' },
]

const DISTANCE_UNITS: { key: DistanceUnit; label: string }[] = [
  { key: 'meters', label: 'Meters' },
  { key: 'kilometers', label: 'Kilometers' },
  { key: 'feet', label: 'Feet' },
  { key: 'miles', label: 'Miles' },
]

const TIME_UNITS: { key: TimeUnit; label: string }[] = [
  { key: 'seconds', label: 'Seconds' },
  { key: 'minutes', label: 'Minutes' },
  { key: 'hours', label: 'Hours' },
]

export function ConfigurationMenu() {
  const { t } = useLingui()
  const [language, setLanguage] = useAtom(languageAtom)
  const [temperatureUnit, setTemperatureUnit] = useAtom(temperatureUnitAtom)
  const [speedUnit, setSpeedUnit] = useAtom(speedUnitAtom)
  const [distanceUnit, setDistanceUnit] = useAtom(distanceUnitAtom)
  const [timeUnit, setTimeUnit] = useAtom(timeUnitAtom)

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

    // Check speed
    if (keyStr === 'kmh' || keyStr === 'mph' || keyStr === 'ms') {
      setSpeedUnit(keyStr as SpeedUnit)

      return
    }

    // Check distance
    if (
      keyStr === 'meters' ||
      keyStr === 'kilometers' ||
      keyStr === 'feet' ||
      keyStr === 'miles'
    ) {
      setDistanceUnit(keyStr as DistanceUnit)

      return
    }

    // Check time
    if (keyStr === 'seconds' || keyStr === 'minutes' || keyStr === 'hours') {
      setTimeUnit(keyStr as TimeUnit)

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
          aria-label="Configuration"
          selectedKeys={[
            language,
            temperatureUnit,
            speedUnit,
            distanceUnit,
            timeUnit,
          ]}
          selectionMode="multiple"
          onAction={handleAction}
          classNames={{
            base: 'max-h-[400px] overflow-y-auto',
          }}
        >
          <DropdownSection title={t(msg`Language`)}>
            {LANGUAGES.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>

          <DropdownSection title={t(msg`Temperature`)}>
            {TEMPERATURE_UNITS.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>

          <DropdownSection title={t(msg`Speed`)}>
            {SPEED_UNITS.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>

          <DropdownSection title={t(msg`Distance`)}>
            {DISTANCE_UNITS.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>

          <DropdownSection title={t(msg`Time`)}>
            {TIME_UNITS.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </>
  )
}
