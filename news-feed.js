function timeAgo(isoDate) {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "agora mesmo";
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours}h`;
  const days = Math.floor(hours / 24);
  return `há ${days}d`;
}

async function loadNewsFeed() {
  const list = document.getElementById("news-feed-list");
  const updated = document.getElementById("news-feed-updated");

  try {
    const res = await fetch("news/news.json", { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();

    if (data.updatedAt) {
      updated.textContent = `Atualizado ${timeAgo(data.updatedAt)}`;
    }

    if (!data.articles || data.articles.length === 0) {
      list.innerHTML = `<p class="news-feed-empty">Nenhuma notícia coletada ainda. O motor roda de hora em hora — volte em breve.</p>`;
      return;
    }

    list.innerHTML = data.articles
      .map(
        (a) => `
          <a href="${a.link}" target="_blank" rel="noopener" class="news-feed-item">
            <span class="news-feed-item-source">${a.source}</span>
            <span class="news-feed-item-title">${a.title}</span>
            <span class="news-feed-item-time">${timeAgo(a.publishedAt)}</span>
          </a>
        `
      )
      .join("");
  } catch (err) {
    list.innerHTML = `<p class="news-feed-empty">Não foi possível carregar as notícias agora (${err.message}).</p>`;
  }
}

loadNewsFeed();
