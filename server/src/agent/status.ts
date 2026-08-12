import { bus, type AgentStatus } from '../bus.ts';

const status: AgentStatus = {
  connected: false,
  lastHeartbeatAt: null,
  extVersion: null,
  lastBlock: null,
  consecutiveEmptyRounds: 0,
  lastParseAt: null,
  currentGroup: null,
};

export function getAgentStatus(): AgentStatus {
  return { ...status };
}

/** Durumu gunceller ve degisikligi UI'a yayinlar. */
export function patchAgentStatus(patch: Partial<AgentStatus>): AgentStatus {
  Object.assign(status, patch);
  bus.emitEvent({ type: 'status', status: getAgentStatus() });
  return getAgentStatus();
}

/**
 * Eklenti son heartbeat'i verilen sure icinde gonderdi mi?
 * Soket acik kalip eklentinin donmus olmasi mumkun oldugu icin
 * "bagli" bayragi tek basina yeterli degildir.
 */
export function isAgentAlive(timeoutSec: number): boolean {
  if (!status.connected || status.lastHeartbeatAt === null) return false;
  return Date.now() - status.lastHeartbeatAt <= timeoutSec * 1000;
}
