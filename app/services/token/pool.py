"""Token 池管理"""

import random
from typing import Dict, List, Optional, Iterator, Set

from app.core.logger import logger
from app.services.token.models import TokenInfo, TokenStatus, TokenPoolStats


class TokenPool:
    """Token 池（管理一组 Token）"""

    def __init__(self, name: str):
        self.name = name
        self._tokens: Dict[str, TokenInfo] = {}

    def add(self, token: TokenInfo):
        """添加 Token"""
        self._tokens[token.token] = token

    def remove(self, token_str: str) -> bool:
        """删除 Token"""
        if token_str in self._tokens:
            del self._tokens[token_str]
            return True
        return False

    def get(self, token_str: str) -> Optional[TokenInfo]:
        """获取 Token"""
        return self._tokens.get(token_str)

    def select(self, exclude: set = None, prefer_tags: Optional[Set[str]] = None) -> Optional[TokenInfo]:
        """
        选择一个可用 Token
        策略:
        1. 选择 active 状态且有配额的 token
        2. 优先选择剩余额度最多的
        3. 如果额度相同，随机选择（避免并发冲突）

        Args:
            exclude: 需要排除的 token 字符串集合
            prefer_tags: 优先选择包含这些 tag 的 token（若存在则仅在其子集中选择）
        """
        all_tokens = list(self._tokens.values())
        logger.info(f"[TOKEN_SELECT] Pool={self.name}, Total tokens={len(all_tokens)}")
        
        for t in all_tokens:
            logger.info(f"[TOKEN_SELECT]   - {t.token[:10]}... status={t.status.value}, quota={t.quota}, tags={t.tags}")
        
        available = [
            t
            for t in all_tokens
            if t.status == TokenStatus.ACTIVE and t.quota > 0
            and (not exclude or t.token not in exclude)
        ]

        logger.info(f"[TOKEN_SELECT] Available tokens after filter: {len(available)}")
        
        if not available:
            logger.warning(f"[TOKEN_SELECT] No available tokens in pool {self.name}")
            return None

        if prefer_tags:
            preferred = [t for t in available if prefer_tags.issubset(set(t.tags or []))]
            if preferred:
                available = preferred
                logger.info(f"[TOKEN_SELECT] Filtered by tags {prefer_tags}: {len(available)} tokens")

        max_quota = max(t.quota for t in available)
        candidates = [t for t in available if t.quota == max_quota]
        
        selected = random.choice(candidates)
        logger.info(f"[TOKEN_SELECT] Selected token: {selected.token[:10]}... quota={selected.quota}")
        
        return selected

    def count(self) -> int:
        """Token 数量"""
        return len(self._tokens)

    def list(self) -> List[TokenInfo]:
        """获取所有 Token"""
        return list(self._tokens.values())

    def get_stats(self) -> TokenPoolStats:
        """获取池统计信息"""
        stats = TokenPoolStats(total=len(self._tokens))

        for token in self._tokens.values():
            stats.total_quota += token.quota

            if token.status == TokenStatus.ACTIVE:
                stats.active += 1
            elif token.status == TokenStatus.DISABLED:
                stats.disabled += 1
            elif token.status == TokenStatus.EXPIRED:
                stats.expired += 1
            elif token.status == TokenStatus.COOLING:
                stats.cooling += 1

        if stats.total > 0:
            stats.avg_quota = stats.total_quota / stats.total

        return stats

    def _rebuild_index(self):
        """重建索引（预留接口，用于加载时调用）"""
        pass

    def __iter__(self) -> Iterator[TokenInfo]:
        return iter(self._tokens.values())


__all__ = ["TokenPool"]
