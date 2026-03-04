import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
} from '@heroui/dropdown'
import { Button } from '@heroui/button'
import { useAtom } from 'jotai'
import { useLingui } from '@lingui/react/macro'

import { languageAtom, type Language } from '@/store/languageAtom'

const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'EN' },
  { key: 'fr', label: 'FR' },
]

export function LanguageSelector() {
  const { t } = useLingui()
  const [language, setLanguage] = useAtom(languageAtom)

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
