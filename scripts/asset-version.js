'use strict';

// 给本站 CSS/JS 的引用加上内容哈希版本号，配合服务器的长期缓存（Cache-Control: immutable）。
//
// NexT 生成的文件名是固定的（/css/main.css、/js/utils.js ……），内容变了名字不变，
// 浏览器长期缓存就会一直用旧文件。这里在所有页面生成完之后：
//   1. 计算每个 css/js 文件最终内容（已经过 hexo-clean-css / hexo-uglify 压缩）的 SHA-256；
//   2. 把 HTML 里 src="/js/x.js"、href="/css/x.css" 改成 src="/js/x.js?v=<哈希前 10 位>"。
// 文件内容一变，版本号就跟着变，浏览器自然会去下载新的；没变的文件可以放心缓存一年。
//
// 服务器（bj-edge 的 Caddy）对带 ?v= 的 /css/*、/js/* 返回一年的 immutable 缓存，
// 不带的返回 no-cache；所以漏改的引用只是每次多问一下服务器，不会拿到旧文件。
// 任何一步出错都会直接让 hexo generate 失败，不会部署半成品。

const { createHash } = require('crypto');

const ASSET_ROUTE = /^(?:css|js)\/.+\.(?:css|js)$/;
// 只匹配带双引号的站内绝对路径；外部 CDN（https://...）和已经带查询参数的引用都不动。
const ASSET_REF = /(\s(?:src|href)=")(\/(?:css|js)\/[^"?#]+\.(?:css|js))(")/g;

function readRoute(route, path) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    route.get(path)
      .on('data', chunk => chunks.push(Buffer.from(chunk)))
      .on('end', () => resolve(Buffer.concat(chunks)))
      .on('error', reject);
  });
}

hexo.extend.filter.register('after_generate', async function () {
  const { route } = this;
  const paths = route.list();

  const versions = new Map();
  for (const path of paths.filter(p => ASSET_ROUTE.test(p))) {
    const data = await readRoute(route, path);
    // 路由内容是按需渲染的，每读一次就重新渲染一次；NexT 的 main.css 每次渲染结果都不同
    // （侧边栏社交链接小圆点 .links-of-author a::before 的颜色是随机的）。
    // 所以把这次读到的内容固定下来，保证最终写出的文件就是算哈希的这一份。
    route.set(path, data);
    versions.set('/' + path, createHash('sha256').update(data).digest('hex').slice(0, 10));
  }

  let rewritten = 0;
  for (const path of paths.filter(p => p.endsWith('.html'))) {
    const html = (await readRoute(route, path)).toString();
    const result = html.replace(ASSET_REF, (match, prefix, url, quote) => {
      const hash = versions.get(url);
      if (!hash) return match;
      rewritten++;
      return `${prefix}${url}?v=${hash}${quote}`;
    });
    if (result !== html) route.set(path, result);
  }

  this.log.info('asset-version: %d 个 css/js 文件，改写了 %d 处引用', versions.size, rewritten);
});
