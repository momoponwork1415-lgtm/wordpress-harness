import {
  experimentExecutionRequestSchema,
  sourceRouteExperimentProtocolSchema,
  type ExperimentExecutionRequest,
  type SourceRouteExperimentProtocol,
} from "./contracts.js";

function rangesOverlap(
  left: { readonly startLine: number; readonly endLine: number },
  right: { readonly startLine: number; readonly endLine: number },
): boolean {
  return left.startLine <= right.endLine && right.startLine <= left.endLine;
}

export function sourceRouteProtocolSupports(
  protocolInput: SourceRouteExperimentProtocol,
  requestInput: ExperimentExecutionRequest,
): boolean {
  const protocol = sourceRouteExperimentProtocolSchema.parse(protocolInput);
  const request = experimentExecutionRequestSchema.parse(requestInput);
  if (
    protocol.adapterVersion !== request.plan.bindings.adapterVersion ||
    protocol.adapterVersion !==
      request.sourceRederivation.experiment.adapterVersion
  ) {
    return false;
  }
  return protocol.requiredSourceEvidence.every((required) =>
    request.sourceRederivation.sourceEvidence.some(
      (actual) =>
        actual.path === required.path &&
        actual.fileDigest === required.fileDigest &&
        rangesOverlap(actual, required),
    ),
  );
}
