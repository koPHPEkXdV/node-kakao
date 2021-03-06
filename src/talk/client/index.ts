/*
 * Created on Mon Jan 18 2021
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { CommandSession, LocoSession, SessionFactory } from '../../network';
import { ChannelUser } from '../../user';
import { AsyncCommandResult, DefaultReq, DefaultRes } from '../../request';
import { Managed } from '../managed';
import { OAuthCredential } from '../../oauth';
import { ClientConfig, DefaultConfiguration } from '../../config';
import { ClientSession, LoginResult } from '../../client';
import { TalkSessionFactory } from '../network';
import { TalkClientSession } from './talk-client-session';
import { KickoutRes } from '../../packet/chat';
import { EventContext, TypedEmitter } from '../../event';
import { ClientStatus } from '../../client-status';
import { TalkChannelList } from '../talk-channel-list';
import { ClientEvents } from '../event';
import { Long } from 'bson';
import { TalkBlockSession } from '../block';

export * from './talk-client-session';

/**
 * Talk client session with client user
 */
export interface TalkSession extends CommandSession {

  readonly clientUser: Readonly<ChannelUser>;

  readonly configuration: Readonly<ClientConfig>;

}

/**
 * Simple client implementation.
 */
export class TalkClient
  extends TypedEmitter<ClientEvents> implements CommandSession, ClientSession, Managed<ClientEvents> {
  private _session: LocoSession | null;

  /**
   * Ping request interval. (Default = 300000 (5 min))
   */
  public pingInterval: number;
  private _pingTask: number | null;

  private _clientSession: TalkClientSession;

  private _clientUser: ChannelUser;
  private _blockList: TalkBlockSession;

  private _channelList: TalkChannelList;

  constructor(
    config: Partial<ClientConfig> = {},
    private _sessionFactory: SessionFactory = new TalkSessionFactory(),
  ) {
    super();

    this.pingInterval = 300000;
    this._pingTask = null;

    this._session = null;
    this._clientSession = new TalkClientSession(this.createSessionProxy(), { ...DefaultConfiguration, ...config });

    this._channelList = new TalkChannelList(this.createSessionProxy());
    this._clientUser = { userId: Long.ZERO };
    this._blockList = new TalkBlockSession(this.createSessionProxy());
  }

  get configuration(): ClientConfig {
    return this._clientSession.configuration;
  }

  set configuration(configuration: ClientConfig) {
    this._clientSession.configuration = configuration;
  }

  get channelList(): TalkChannelList {
    if (!this.logon) throw new Error('Cannot access without logging in');

    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this._channelList!;
  }

  get clientUser(): ChannelUser {
    if (!this.logon) throw new Error('Cannot access without logging in');

    return this._clientUser;
  }

  get blockList(): TalkBlockSession {
    if (!this.logon) throw new Error('Cannot access without logging in');

    return this._blockList;
  }

  /**
   * true if session created
   */
  get logon(): boolean {
    return this._session != null;
  }

  private get session() {
    if (this._session == null) throw new Error('Session is not created');

    return this._session;
  }

  async login(credential: OAuthCredential): AsyncCommandResult<LoginResult> {
    if (this.logon) this.close();

    // Create session
    const sessionRes = await this._sessionFactory.createSession(this.configuration);
    if (!sessionRes.success) return sessionRes;
    this._session = sessionRes.result;
    this.listen();

    const loginRes = await this._clientSession.login(credential);
    if (!loginRes.success) return loginRes;

    this.addPingHandler();
    this._clientUser = { userId: loginRes.result.userId };

    await TalkChannelList.initialize(this._channelList, loginRes.result.channelList);

    return { status: loginRes.status, success: true, result: loginRes.result };
  }

  setStatus(status: ClientStatus): AsyncCommandResult {
    return this._clientSession.setStatus(status);
  }

  getTokens(unknown: number[]): AsyncCommandResult<DefaultRes> {
    return this._clientSession.getTokens(unknown);
  }

  /**
   * @param {ChannelUser} user Target user to compare
   *
   * @return {boolean} true if client user.
   */
  isClientUser(user: ChannelUser): boolean {
    return user.userId.equals(this._clientUser.userId);
  }

  /**
   * End session
   */
  close(): void {
    this.session.close();
  }

  pushReceived(method: string, data: DefaultRes): void {
    const ctx = new EventContext<ClientEvents>(this);

    this._channelList.pushReceived(method, data, ctx);

    switch (method) {
      case 'KICKOUT': {
        super.emit('disconnected', (data as DefaultRes & KickoutRes).reason);
        this.close();
        break;
      }

      case 'CHANGESVR': {
        super.emit('switch_server');
        break;
      }
    }
  }

  /**
   * Create proxy that can be used safely without exposing client
   *
   * @return {TalkSession}
   */
  createSessionProxy(): TalkSession {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const instance = this;

    return {
      request: (method, data) => this.request(method, data),

      get clientUser() {
        return instance.clientUser;
      },

      get configuration() {
        return instance.configuration;
      },
    };
  }

  request<T = DefaultRes>(method: string, data: DefaultReq): Promise<DefaultRes & T> {
    return this.session.request<T>(method, data);
  }

  private listenEnd() {
    if (this._session) this._session = null;
    if (this._pingTask) {
      clearTimeout(this._pingTask);
    }
  }

  private onError(err: unknown) {
    super.emit('error', err);

    if (this.listeners('error').length > 0) {
      this.listen();
    } else {
      this.close();
    }
  }

  private listen() {
    (async () => {
      for await (const { method, data, push } of this.session.listen()) {
        if (push) {
          this.pushReceived(method, data);
        }
      }
    })().then(this.listenEnd.bind(this)).catch(this.onError.bind(this));
  }

  private addPingHandler() {
    const pingHandler = () => {
      if (!this.logon) return;

      this.session.request('PING', {});
      // Fix weird nodejs typing
      this._pingTask = setTimeout(pingHandler, this.pingInterval) as unknown as number;
    };
    pingHandler();
  }
}
