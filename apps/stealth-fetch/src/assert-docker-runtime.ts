/**
 * Ensures the service runs only inside its Docker image (see Dockerfile / compose).
 */

export function assertDockerRuntime(): void {
  if (process.env.STEALTH_IN_CONTAINER !== "true") {
    throw new Error(
      "stealth-fetch must run inside its Docker container (docker-compose.yml). " +
        "Do not start it with npm on the host.",
    );
  }
}
