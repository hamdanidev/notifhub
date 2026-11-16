import { Injectable } from '@nestjs/common';

/**
 * Readiness gate for background work (delivery workers).
 *
 * PrismaService marks the service ready only after `$connect()` succeeds, so a worker
 * never processes a job against a database connection that is not established yet
 * (PART 1 rule 28).
 */
@Injectable()
export class ReadinessService {
  private ready = false;
  private resolveReady: (() => void) | undefined;
  private readonly readyPromise = new Promise<void>((resolve) => {
    this.resolveReady = resolve;
  });

  isReady(): boolean {
    return this.ready;
  }

  markReady(): void {
    if (this.ready) {
      return;
    }

    this.ready = true;
    this.resolveReady?.();
  }

  untilReady(): Promise<void> {
    return this.ready ? Promise.resolve() : this.readyPromise;
  }
}
