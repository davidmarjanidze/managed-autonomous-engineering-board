import { Controller, Delete, Get, Param, Sse } from "@nestjs/common";
import { Observable, map } from "rxjs";

import { RuntimeHealth, SessionsService } from "@src/sessions/sessions.service";

@Controller("sessions")
export class SessionsController {
  constructor(private readonly sessionsService: SessionsService) {}

  @Get("runtime-health")
  runtimeHealth(): RuntimeHealth {
    return this.sessionsService.getRuntimeHealth();
  }

  @Get("managed")
  listManaged(): Array<{ localId: string; remoteId: string }> {
    return this.sessionsService.getActiveRemoteSessions();
  }

  @Delete("managed/:localSessionId")
  async terminateSession(
    @Param("localSessionId") localSessionId: string,
  ): Promise<{ terminated: boolean }> {
    const terminated =
      await this.sessionsService.terminateRemoteSession(localSessionId);
    return { terminated };
  }

  @Delete("managed")
  async terminateAll(): Promise<{ terminated: number }> {
    const active = this.sessionsService.getActiveRemoteSessions();
    const results = await Promise.all(
      active.map((s) => this.sessionsService.terminateRemoteSession(s.localId)),
    );
    return { terminated: results.filter(Boolean).length };
  }

  @Sse(":sessionId/stream")
  streamSession(
    @Param("sessionId") sessionId: string,
  ): Observable<MessageEvent> {
    return this.sessionsService
      .getStream(sessionId)
      .pipe(
        map(
          (event: Record<string, unknown>) =>
            ({ data: JSON.stringify(event) }) as MessageEvent,
        ),
      );
  }
}
