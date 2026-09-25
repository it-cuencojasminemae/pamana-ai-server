'use strict';

/**
 * The current schema represents a transfer at one shared TransportNode and
 * requires both variant stops to permit transfer. Names and proximity are
 * deliberately ignored.
 */
function canTransfer(firstEdge, secondEdge) {
  return Boolean(
    firstEdge
    && secondEdge
    && firstEdge.variant.id !== secondEdge.variant.id
    && firstEdge.alightStop.node.id === secondEdge.boardStop.node.id
    && firstEdge.alightStop.transferAllowed
    && secondEdge.boardStop.transferAllowed
  );
}

module.exports = { canTransfer };
