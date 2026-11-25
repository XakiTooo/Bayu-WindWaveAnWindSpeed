export function recordCommandAck(devices, ack, action, nonce) {
  if (ack?.cmd !== action || ack?.nonce !== nonce || ack?.status !== 'applied') return false;
  if (action !== 'buzzer_mute' && action !== 'buzzer_unmute') return true;
  if (ack.device === 'sender' || ack.device === 'receiver') devices.add(ack.device);
  return devices.has('sender') && devices.has('receiver');
}
