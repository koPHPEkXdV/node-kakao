/*
 * Created on Tue Jun 30 2020
 *
 * Copyright (c) storycraft. Licensed under the MIT Licence.
 */

import { RequestHeader } from "./web-api-client";
import { KakaoAPI } from "../kakao-api";
import { LoginClient } from "../client";

export interface ApiHeaderDecorator {

    fillHeader(header: RequestHeader): this;

}

export class BasicHeaderDecorator implements ApiHeaderDecorator {

    static readonly INSTANCE = new BasicHeaderDecorator();

    private constructor() {

    }

    fillHeader(header: RequestHeader) {
        header['Accept'] = '*/*';
        header['Accept-Language'] = KakaoAPI.Language;
        header['User-Agent'] = KakaoAPI.AuthUserAgent;

        return this;
    }

}

export class AHeaderDecorator implements ApiHeaderDecorator {

    static readonly INSTANCE = new AHeaderDecorator();

    private constructor() {

    }

    fillHeader(header: RequestHeader) {
        header['A'] = KakaoAPI.AuthHeaderAgent;

        return this;
    }

}

export class CHeaderDecorator implements ApiHeaderDecorator {

    constructor() {

    }

    fillHeader(header: RequestHeader) {
        // TODO
        return this;
    }

}

export class SessionHeaderDecorator implements ApiHeaderDecorator {

    constructor(private client: LoginClient) {

    }

    fillHeader(header: RequestHeader) {
        header['Authorization'] = `${this.client.getLatestAccessData().accessToken}-${this.client.DeviceUUID}`;

        return this;
    }

}