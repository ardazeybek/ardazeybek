"""Katkı takvimini GitHub API'den çekip temaya uyumlu, animasyonlu assets/activity.svg üretir (yalnız standart kütüphane)."""
import json, os, sys, urllib.request

USER = os.environ.get("GH_USER", "ardazeybek")
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets", "activity.svg")
LEVELS = ["e", "l1", "l2", "l3", "l4"]
Q = '{user(login:"%s"){contributionsCollection{contributionCalendar{weeks{contributionDays{contributionCount}}}}}}'


# GraphQL ile haftalık katkı sayılarını çeker
def fetch(token):
    req = urllib.request.Request("https://api.github.com/graphql", data=json.dumps({"query": Q % USER}).encode(),
                                 headers={"Authorization": f"bearer {token}", "User-Agent": "profile-activity"})
    data = json.load(urllib.request.urlopen(req))
    return [[d["contributionCount"] for d in w["contributionDays"]] for w in
            data["data"]["user"]["contributionsCollection"]["contributionCalendar"]["weeks"]]


# Sayıyı 0-4 yoğunluk seviyesine çevirir
def level(n, mx):
    return 0 if n == 0 else min(4, 1 + int(3 * n / max(mx, 1)))


# Hücre ızgarasını SVG olarak yazar
def build(weeks):
    mx = max((n for w in weeks for n in w), default=0)
    cells = []
    for x, w in enumerate(weeks):
        for y, n in enumerate(w):
            lv = level(n, mx)
            cls, fill = LEVELS[lv], ""
            cells.append(f'<rect class="{cls}" x="{x*17}" y="{y*17}" width="13" height="13" rx="3.5"{fill} style="animation-delay:{x*18}ms"/>')
    w, h = len(weeks) * 17 - 4, 7 * 17 - 4
    css = (".e{fill:#ebeef1}.l1{fill:#c4c9cf}.l2{fill:#8c949c}.l3{fill:#4f565d}.l4{fill:#1f2328}"
           "@media (prefers-color-scheme:dark){.e{fill:#161b22}.l1{fill:#3d444d}.l2{fill:#768390}.l3{fill:#adbac7}.l4{fill:#f0f6fc}}"
           "rect{opacity:0;animation:in .5s ease-out forwards}@keyframes in{to{opacity:1}}"
           "@media (prefers-reduced-motion:reduce){rect{animation:none;opacity:1}}")
    return (f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" '
            f'aria-label="Contribution activity for the last year"><style>{css}</style>{"".join(cells)}</svg>')


if __name__ == "__main__":
    token = os.environ.get("GITHUB_TOKEN") or sys.exit("GITHUB_TOKEN gerekli")
    open(OUT, "w").write(build(fetch(token)))
    print("activity.svg yazıldı")
