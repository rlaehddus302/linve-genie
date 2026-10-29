CREATE TABLE voice_aliases (
  seller_id text PRIMARY KEY,
  aliases text NOT NULL DEFAULT '[]',
  CONSTRAINT voice_aliases_seller_id_sellers_id_fk FOREIGN KEY (seller_id) REFERENCES sellers(id)
);
