alter table societies add column archived_at timestamptz;

update societies set archived_at = now()
where source in ('curated', 'rera') and archived_at is null;

-- Keeps the oldest row per place; the unique index below cannot be built over duplicates.
update societies s set place_id = null
where s.place_id is not null
  and exists (select 1 from societies o
              where o.place_id = s.place_id
                and (o.created_at, o.id) < (s.created_at, s.id));

create unique index uq_societies_place_id on societies (place_id) where place_id is not null;

comment on column societies.archived_at is
    'Set when the row was retired from the public catalogue; existing bindings stay, new ones are refused.';
