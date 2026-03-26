import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
} from '@heroui/dropdown'
import { Button } from '@heroui/button'
import { Slider } from '@heroui/slider'
import { useAtom } from 'jotai'
import { IconSettings } from '@tabler/icons-react'
import { Trans } from '@lingui/react/macro'
import { useLingui } from '@lingui/react/macro'
import { Key } from 'react'

import {
  languageAtom,
  temperatureUnitAtom,
  invertDragAtom,
  dragSensitivityAtom,
  showLogsAtom,
  type Language,
  type TemperatureUnit,
} from '@/store/settingsAtom'

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
  const [invertDrag, setInvertDrag] = useAtom(invertDragAtom)
  const [dragSensitivity, setDragSensitivity] = useAtom(dragSensitivityAtom)
  const [showLogs, setShowLogs] = useAtom(showLogsAtom)

  const handleAction = (key: Key) => {
    const keyStr = String(key)

    if (keyStr === 'en' || keyStr === 'fr') {
      setLanguage(keyStr as Language)

      return
    }

    if (keyStr === 'celsius' || keyStr === 'fahrenheit') {
      setTemperatureUnit(keyStr as TemperatureUnit)

      return
    }

    if (keyStr === 'invert-drag') {
      setInvertDrag(!invertDrag)

      return
    }

    if (keyStr === 'show-logs') {
      setShowLogs(!showLogs)

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
          selectedKeys={[
            language,
            temperatureUnit,
            ...(invertDrag ? ['invert-drag'] : []),
            ...(showLogs ? ['show-logs'] : []),
          ]}
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

          <DropdownSection title={t`Camera Controls`}>
            <DropdownItem key="invert-drag">
              {t`Invert drag direction`}
            </DropdownItem>
            <DropdownItem
              key="drag-sensitivity"
              isReadOnly
              classNames={{
                base: '!bg-transparent !cursor-default',
              }}
              textValue={t`Drag sensitivity`}
            >
              <Slider
                aria-label={t`Drag sensitivity`}
                label={<Trans>Drag sensitivity</Trans>}
                maxValue={0.2}
                minValue={0.01}
                size="sm"
                step={0.01}
                value={dragSensitivity}
                onChange={(v) => setDragSensitivity(v as number)}
              />
            </DropdownItem>
          </DropdownSection>

          <DropdownSection title={t`Developer`}>
            <DropdownItem key="show-logs">{t`Show Logs`}</DropdownItem>
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>
    </>
  )
}
