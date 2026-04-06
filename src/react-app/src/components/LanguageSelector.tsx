/**
 * Author: Zifan Si
 * Date: 2026-02-01
 * Purpose: Displays a compact control for switching application language.
 */
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/dropdown'
import { Button } from '@heroui/button'
import { useAtom } from 'jotai'
import { useLingui } from '@lingui/react/macro'

import { languageAtom, type Language } from '@/store/settingsAtom'

const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'EN' },
  { key: 'fr', label: 'FR' },
]

/**
 * Switches the active locale from a compact language dropdown.
 *
 * @returns Language selector button and menu.
 */
export function LanguageSelector() {
  const { t } = useLingui()
  const [language, setLanguage] = useAtom(languageAtom)

  /**
   * Updates the active language preference from the selected menu key.
   *
   * @param key Selected dropdown key representing a supported language.
   * @returns No return value.
   */
  const handleLanguageChange = (key: React.Key) => {
    const lang = key as Language

    setLanguage(lang)
  }

  return (
    <Dropdown>
      <DropdownTrigger>
        <Button radius="sm" variant="bordered">
          {language.toUpperCase()}
        </Button>
      </DropdownTrigger>
      <DropdownMenu
        aria-label={t`Select language`}
        selectedKeys={[language]}
        selectionMode="single"
        onSelectionChange={(keys) => {
          const selected = Array.from(keys)[0]

          if (selected) handleLanguageChange(selected)
        }}
      >
        {LANGUAGES.map(({ key, label }) => (
          <DropdownItem key={key}>{label}</DropdownItem>
        ))}
      </DropdownMenu>
    </Dropdown>
  )
}
