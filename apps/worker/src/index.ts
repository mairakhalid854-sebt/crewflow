export interface WorkerIdentity {
  readonly service: 'crewflow-worker';
  readonly status: 'idle';
}

export function getWorkerIdentity(): WorkerIdentity {
  return { service: 'crewflow-worker', status: 'idle' };
}
