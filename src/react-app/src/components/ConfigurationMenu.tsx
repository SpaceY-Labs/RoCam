import { useState } from 'react'
import {
  Dropdown,
  DropdownTrigger,
  DropdownMenu,
  DropdownItem,
  DropdownSection,
} from '@heroui/dropdown'
import { Button } from '@heroui/button'
import { Modal, ModalContent, ModalHeader, ModalBody } from '@heroui/modal'
import { useAtom } from 'jotai'
import { IconSettings } from '@tabler/icons-react'
import { Trans } from '@lingui/react/macro'
import { msg } from '@lingui/core/macro'
import { useLingui } from '@lingui/react'

import { languageAtom, type Language } from '@/store/languageAtom'

const LANGUAGES: { key: Language; label: string }[] = [
  { key: 'en', label: 'EN' },
  { key: 'fr', label: 'FR' },
]

export function ConfigurationMenu() {
  const { i18n } = useLingui()
  const [language, setLanguage] = useAtom(languageAtom)
  const [metricsModalOpen, setMetricsModalOpen] = useState(false)

  const handleAction = (key: React.Key) => {
    if (key === 'change-metrics') {
      setMetricsModalOpen(true)
    } else {
      setLanguage(key as Language)
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
          selectedKeys={[language]}
          selectionMode="single"
          onAction={handleAction}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0]

            if (selected && selected !== 'change-metrics') {
              setLanguage(selected as Language)
            }
          }}
        >
          <DropdownSection title={i18n._(msg`Language`)}>
            {LANGUAGES.map(({ key, label }) => (
              <DropdownItem key={key}>{label}</DropdownItem>
            ))}
          </DropdownSection>
          <DropdownSection title={i18n._(msg`Units`)}>
            <DropdownItem key="change-metrics">
              <Trans>Change metrics</Trans>
            </DropdownItem>
          </DropdownSection>
        </DropdownMenu>
      </Dropdown>

      <Modal
        isOpen={metricsModalOpen}
        onClose={() => setMetricsModalOpen(false)}
      >
        <ModalContent>
          {() => (
            <>
              <ModalHeader className="flex flex-col">
                <Trans>Change metrics</Trans>
              </ModalHeader>
              <ModalBody>
                <p>
                  <Trans>Not implemented</Trans>
                </p>
              </ModalBody>
            </>
          )}
        </ModalContent>
      </Modal>
    </>
  )
}
