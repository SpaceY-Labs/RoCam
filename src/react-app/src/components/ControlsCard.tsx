import { useState } from 'react'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import { addToast } from '@heroui/toast'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconHome,
} from '@tabler/icons-react'
import { useTimeoutFn } from 'react-use'
import { Trans, useLingui } from '@lingui/react/macro'

import { useRocam } from '@/network/rocamProvider'

export function ControlsCard() {
  const { t } = useLingui()
  const { apiClient, status } = useRocam()
  const [isArmLoading, setIsArmLoading] = useState(false)
  const [isRecordLoading, setIsRecordLoading] = useState(false)
  const [isCooldownActive, setIsCooldownActive] = useState(false)

  const isArmed = !!status?.armed
  const isRecording = !!status?.is_recording

  const [, , reset] = useTimeoutFn(() => {
    setIsCooldownActive(false)
  }, 1500)

  const startCooldown = () => {
    setIsCooldownActive(true)
    reset()
  }

  const cooldownOrLoading = isCooldownActive || isArmLoading || isRecordLoading

  const handleToggleArm = async () => {
    if (!apiClient || cooldownOrLoading) return
    setIsArmLoading(true)
    startCooldown()
    try {
      if (isArmed) {
        await apiClient.disarm()
      } else {
        await apiClient.arm()
      }
    } catch (error) {
      addToast({
        title: isArmed ? t`Failed to disarm` : t`Failed to arm`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    } finally {
      setIsArmLoading(false)
    }
  }

  const handleToggleRecording = async () => {
    if (!apiClient || cooldownOrLoading) return
    setIsRecordLoading(true)
    startCooldown()
    try {
      if (isRecording) {
        await apiClient.stopRecording()
        addToast({ title: t`Recording stopped`, color: 'success' })
      } else {
        await apiClient.startRecording()
        addToast({ title: t`Recording started`, color: 'success' })
      }
    } catch (error) {
      addToast({
        title: isRecording ? t`Failed to stop recording` : t`Failed to start recording`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    } finally {
      setIsRecordLoading(false)
    }
  }

  return (
    <Card radius="sm">
      <CardBody className="px-6 py-5">
        <p className="text-xs font-semibold uppercase text-gray-800 tracking-widest">
          <Trans>Controls</Trans>
        </p>
        <div className="flex gap-8 mt-4">
          <GimbalPad />
          <div className="flex flex-col justify-center gap-3">
            <Button
              color="danger"
              isDisabled={!apiClient || cooldownOrLoading}
              radius="sm"
              variant="bordered"
              onPress={handleToggleRecording}
            >
              {isRecording ? (
                <Trans>Stop Recording</Trans>
              ) : (
                <Trans>Start Recording</Trans>
              )}
            </Button>
            <Button
              className="border-amber-500 text-amber-600"
              color="warning"
              isDisabled={!apiClient || cooldownOrLoading}
              radius="sm"
              variant="bordered"
              onPress={handleToggleArm}
            >
              {isArmed ? <Trans>Disarm</Trans> : <Trans>Arm</Trans>}
            </Button>
          </div>
        </div>
      </CardBody>
    </Card>
  )
}

function GimbalPad() {
  const { t } = useLingui()
  const { apiClient, status } = useRocam()
  const disabled = !!status?.armed
  const handleMove = async (
    move: () => Promise<unknown>,
    actionLabel: string
  ) => {
    try {
      await move()
    } catch (error) {
      addToast({
        title: t`Failed to move ${actionLabel}`,
        description: getErrorMessage(error),
        color: 'danger',
      })
    }
  }

  return (
    <div className="grid gap-2 grid-cols-3 grid-rows-3 w-fit">
      <div />
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => {
          if (!apiClient) return
          void handleMove(() => apiClient.manualMove('up'), 'up')
        }}
      >
        <IconChevronUp />
      </Button>
      <div />
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => {
          if (!apiClient) return
          void handleMove(() => apiClient.manualMove('left'), 'left')
        }}
      >
        <IconChevronLeft />
      </Button>
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => {
          if (!apiClient) return
          void handleMove(() => apiClient.manualMoveTo(0, 0), 'home')
        }}
      >
        <IconHome />
      </Button>
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => {
          if (!apiClient) return
          void handleMove(() => apiClient.manualMove('right'), 'right')
        }}
      >
        <IconChevronRight />
      </Button>
      <div />
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => {
          if (!apiClient) return
          void handleMove(() => apiClient.manualMove('down'), 'down')
        }}
      >
        <IconChevronDown />
      </Button>
      <div />
    </div>
  )
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) return error.message

  return String(error ?? 'Unknown error')
}
