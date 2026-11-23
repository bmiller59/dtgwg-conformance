// SPDX-License-Identifier: Apache-2.0
// `--adapter module:src/adapters/vti/index.ts` loads this (in-process; configuration from the VTI_* environment, see adapter.ts).
export { createAdapter, VtiAdapter, VTI_ADAPTER_NAME, VTC_HOST_NAME } from "./adapter.ts";
