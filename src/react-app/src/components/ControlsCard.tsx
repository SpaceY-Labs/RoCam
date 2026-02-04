import { useState } from 'react'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconHome,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react'
import { useTimeoutFn } from 'react-use'
import { Trans } from '@lingui/react/macro'

import { useRocam } from '@/network/rocamProvider'

export function ControlsCard() {
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
    } catch {
      console.warn(`Failed to ${isArmed ? 'disarm' : 'arm'}`)
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
      } else {
        await apiClient.startRecording()
      }
    } catch {
      console.warn(`Failed to ${isRecording ? 'stop' : 'start'} recording`)
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
          <FocalLengthControls />
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
  const { apiClient, status } = useRocam()
  const disabled = !!status?.armed

  return (
    <div className="grid gap-2 grid-cols-3 grid-rows-3 w-fit">
      <div />
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => apiClient?.manualMove('up')}
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
        onPress={() => apiClient?.manualMove('left')}
      >
        <IconChevronLeft />
      </Button>
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => apiClient?.manualMoveTo(0, 0)}
      >
        <IconHome />
      </Button>
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={() => apiClient?.manualMove('right')}
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
        onPress={() => apiClient?.manualMove('down')}
      >
        <IconChevronDown />
      </Button>
      <div />
    </div>
  )
}

function FocalLengthControls() {
  const { apiClient, status } = useRocam()
  const disabled = !!status?.armed
  const currentFocalLength = status?.focal_length ?? 24

  const handleZoomIn = () => {
    if (!apiClient || disabled) return
    const newFocalLength = Math.min(200, currentFocalLength + 10)

    apiClient.setFocalLength(newFocalLength)
  }

  const handleZoomOut = () => {
    if (!apiClient || disabled) return
    const newFocalLength = Math.max(10, currentFocalLength - 10)

    apiClient.setFocalLength(newFocalLength)
  }

  return (
    <div className="flex flex-col justify-center gap-2">
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={handleZoomIn}
      >
        <IconZoomIn />
      </Button>
      <Button
        isIconOnly
        disabled={disabled}
        radius="sm"
        size="lg"
        variant="flat"
        onPress={handleZoomOut}
      >
        <IconZoomOut />
      </Button>
    </div>
  )
}
