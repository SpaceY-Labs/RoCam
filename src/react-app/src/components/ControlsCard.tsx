import { useState } from 'react'
import { Button } from '@heroui/button'
import { Card, CardBody } from '@heroui/card'
import {
  IconChevronLeft,
  IconChevronRight,
  IconChevronUp,
  IconChevronDown,
  IconHome,
} from '@tabler/icons-react'
import { useTimeoutFn } from 'react-use'

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
      console.error(`Failed to ${isArmed ? 'disarm' : 'arm'}`)
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
      console.error(`Failed to ${isRecording ? 'stop' : 'start'} recording`)
    } finally {
      setIsRecordLoading(false)
    }
  }

  return (
    <Card radius="sm">
      <CardBody className="px-6 py-5">
        <p className="text-xs font-semibold text-gray-800 tracking-widest">
          CONTROLS
        </p>
        <div className="flex gap-8 mt-4">
          <GimbalPad />
          <div className="flex flex-col justify-center gap-3">
            <Button
              isDisabled={!apiClient || cooldownOrLoading}
              radius="sm"
              variant="bordered"
              color="danger"
              onPress={handleToggleRecording}
            >
              {isRecording ? 'Stop Recording' : 'Start Recording'}
            </Button>
            <Button
              isDisabled={!apiClient || cooldownOrLoading}
              radius="sm"
              variant="bordered"
              color="warning"
              className="border-amber-500 text-amber-600"
              onPress={handleToggleArm}
            >
              {isArmed ? 'Disarm' : 'Arm'}
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
