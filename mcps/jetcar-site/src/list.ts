import { DomUtils, parseDocument } from 'htmlparser2';
import { categories, requestJetcar, type VehicleCategory } from './site.js';

const origin = 'https://jetcar.co.kr';
const pageSize = 16;

/** Fetch only the requested public listing page. A full page does not prove another exists. */
export async function listVehicles(category: VehicleCategory, page: number, signal?: AbortSignal) {
  if (!Number.isSafeInteger(page) || page < 1) throw new Error('쪽 번호는 1 이상의 정수여야 합니다.');
  const { path, label } = categories[category];
  const response = page === 1
    ? await requestJetcar(`/${path}`, { signal })
    : await requestJetcar('/jetcar/ajax_list.page.php', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams({ bo_table: path, sca: '', page: String(page) }),
        signal,
      });
  const document = parseDocument(await response.text());
  const gallery = DomUtils.findOne((element) => element.attribs.id === 'gall_ul', document.children);
  if (!gallery) throw new Error('제트카 응답에서 차량 목록을 찾지 못했습니다.');
  const cards = DomUtils.findAll((element) => (element.attribs.class ?? '').split(/\s+/).includes('gall_li'), gallery.children);
  const findClass = (nodes: typeof gallery.children, name: string) =>
    DomUtils.findOne((element) => (element.attribs.class ?? '').split(/\s+/).includes(name), nodes);
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  const vehicles = cards.map((card) => {
    const titleLink = findClass(card.children, 'bo_tit');
    const specs = findClass(card.children, 'bo_cnt');
    const price = findClass(card.children, 'plus');
    const imageContainer = findClass(card.children, 'gall_img');
    const image = imageContainer && DomUtils.findOne((element) => element.name === 'img', imageContainer.children);
    const href = titleLink?.attribs.href;
    const url = href ? new URL(href, origin) : null;
    const match = url?.origin === origin && url.pathname.match(new RegExp(`^/${path}/(\\d+)/?$`));
    if (!titleLink || !url || !match) throw new Error('제트카 응답에서 차량 상세 링크를 읽지 못했습니다.');
    url.search = '';
    url.hash = '';
    return {
      id: match[1],
      category,
      title: clean(DomUtils.textContent(titleLink)),
      url: url!.href,
      imageUrl: image?.attribs.src ? new URL(image.attribs.src, origin).href : null,
      description: specs ? clean(DomUtils.textContent(specs)) : null,
      price: price ? clean(DomUtils.textContent(price)) : null,
    };
  });
  // The vendor supplies no reliable continuation marker: a full page may be the last.
  const hasMore = vehicles.length < pageSize ? false : null;
  return { category, categoryLabel: label, sourceUrl: `${origin}/${path}`, page, vehicles, hasMore, nextPage: hasMore === false ? null : page + 1 };
}
