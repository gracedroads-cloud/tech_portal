const FLOW_STATES = {
  NEW: 'new',
  ANSWERED: 'answered',
  INTAKE: 'intake',
  SCOPE_CHECKED: 'scope_check',
  QUOTED: 'quote',
  PAYMENT_LINK_SENT: 'payment_link',
  TECHNICIAN_OFFERED: 'technician_offer',
  TECHNICIAN_ACCEPTED: 'technician_acceptance',
  WORK_ORDER_CREATED: 'work_order_create',
  CLOSED_OUT: 'closeout'
};

const TRANSITIONS = {
  [FLOW_STATES.NEW]: [FLOW_STATES.ANSWERED],
  [FLOW_STATES.ANSWERED]: [FLOW_STATES.INTAKE],
  [FLOW_STATES.INTAKE]: [FLOW_STATES.SCOPE_CHECKED],
  [FLOW_STATES.SCOPE_CHECKED]: [FLOW_STATES.QUOTED],
  [FLOW_STATES.QUOTED]: [FLOW_STATES.PAYMENT_LINK_SENT],
  [FLOW_STATES.PAYMENT_LINK_SENT]: [FLOW_STATES.TECHNICIAN_OFFERED],
  [FLOW_STATES.TECHNICIAN_OFFERED]: [FLOW_STATES.TECHNICIAN_OFFERED, FLOW_STATES.TECHNICIAN_ACCEPTED],
  [FLOW_STATES.TECHNICIAN_ACCEPTED]: [FLOW_STATES.WORK_ORDER_CREATED],
  [FLOW_STATES.WORK_ORDER_CREATED]: [FLOW_STATES.CLOSED_OUT],
  [FLOW_STATES.CLOSED_OUT]: []
};

const ENDPOINT_TO_STATE = {
  answer: FLOW_STATES.ANSWERED,
  intake: FLOW_STATES.INTAKE,
  scope_check: FLOW_STATES.SCOPE_CHECKED,
  quote: FLOW_STATES.QUOTED,
  payment_link: FLOW_STATES.PAYMENT_LINK_SENT,
  technician_offer: FLOW_STATES.TECHNICIAN_OFFERED,
  technician_acceptance: FLOW_STATES.TECHNICIAN_ACCEPTED,
  work_order_create: FLOW_STATES.WORK_ORDER_CREATED,
  closeout: FLOW_STATES.CLOSED_OUT
};

function transitionState(call, action, metadata = {}) {
  const next = ENDPOINT_TO_STATE[action];
  if (!next) {
    throw new Error(`Unknown call-flow action: ${action}`);
  }

  const current = call.state;
  const allowed = TRANSITIONS[current] || [];
  if (!allowed.includes(next)) {
    throw new Error(`Invalid transition from ${current} to ${next}.`);
  }

  const previousState = call.state;
  call.state = next;
  const stateEvent = {
    timestamp: new Date().toISOString(),
    action,
    from: previousState,
    to: next,
    metadata
  };
  call.stateHistory.push(stateEvent);
  return stateEvent;
}

module.exports = {
  FLOW_STATES,
  transitionState
};
