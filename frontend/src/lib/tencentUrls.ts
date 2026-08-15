/** Tencent public URLs. Browser CORS is open on these hosts. */

export function quoteUrl(codes: string[]): string {
  return `https://qt.gtimg.cn/q=${codes.join(",")}`;
}

export function tencentMinuteUrl(code: string): string {
  return `https://ifzq.gtimg.cn/appstock/app/minute/query?code=${code}`;
}

export function tencentRankUrl(n: number, type: string, dir: number): string {
  return `https://ifzq.gtimg.cn/appstock/app/mktHs/rank?l=${n}&p=1&t=${type}/averatio&o=${dir}`;
}
