package com.draazy.api.engagement.flatmate;

import static org.assertj.core.api.Assertions.assertThat;

import java.lang.reflect.RecordComponent;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;

// An unclassified new request component would be editable on a published post forever with nothing
// going red, so every component is mutated here rather than read from the source.
@DisplayName("FlatmateEditRules — every request field is classified or declared silent")
class FlatmateEditRulesCoverageTest {

    private final FlatmateEditRules rules = new FlatmateEditRules();

    @Nested
    @DisplayName("room")
    class Rooms {

        @Test
        @DisplayName("re-saving the stored values changes nothing")
        void unchangedIsSilent() {
            FlatmateRoomCreateRequest in = roomRequest();
            assertThat(rules.classify(roomMatching(in), in)).isEqualTo(FlatmateEditImpact.SILENT);
        }

        @Test
        @DisplayName("every component either moves the classifier or is declared silent")
        void everyComponentIsAccountedFor() {
            FlatmateRoomCreateRequest base = roomRequest();
            FlatmateRoom stored = roomMatching(base);
            assertEachComponent(FlatmateRoomCreateRequest.class, base,
                    mutated -> rules.classify(stored, (FlatmateRoomCreateRequest) mutated));
        }
    }

    @Nested
    @DisplayName("group")
    class Groups {

        @Test
        @DisplayName("re-saving the stored values changes nothing")
        void unchangedIsSilent() {
            FlatmateGroupCreateRequest in = groupRequest();
            assertThat(classifyGroup(groupMatching(in), in))
                    .isEqualTo(FlatmateEditImpact.SILENT);
        }

        @Test
        @DisplayName("every component either moves the classifier or is declared silent")
        void everyComponentIsAccountedFor() {
            FlatmateGroupCreateRequest base = groupRequest();
            FlatmateGroup stored = groupMatching(base);
            assertEachComponent(FlatmateGroupCreateRequest.class, base,
                    mutated -> classifyGroup(stored, (FlatmateGroupCreateRequest) mutated));
        }

        // Mirrors the caller: locality and seats reach the rules already resolved, so resolving
        // them here keeps a mutation to either visible.
        private FlatmateEditImpact classifyGroup(FlatmateGroup stored,
                FlatmateGroupCreateRequest in) {
            int seats = in.seats() == null ? 2 : in.seats();
            return rules.classify(stored, in, in.locality(), seats);
        }
    }

    @Nested
    @DisplayName("seeker post")
    class SeekerPosts {

        @Test
        @DisplayName("re-saving the stored values changes nothing")
        void unchangedIsSilent() {
            FlatmateSeekerPostCreateRequest in = postRequest();
            assertThat(rules.classify(postMatching(in), in))
                    .isEqualTo(FlatmateEditImpact.SILENT);
        }

        @Test
        @DisplayName("every component either moves the classifier or is declared silent")
        void everyComponentIsAccountedFor() {
            FlatmateSeekerPostCreateRequest base = postRequest();
            FlatmateSeekerPost stored = postMatching(base);
            assertEachComponent(FlatmateSeekerPostCreateRequest.class, base,
                    mutated -> rules.classify(stored, (FlatmateSeekerPostCreateRequest) mutated));
        }
    }


    private static void assertEachComponent(Class<?> record, Object base,
            Function<Object, FlatmateEditImpact> classify) {
        Set<String> declaredSilent = FlatmateEditRules.SILENT.get(record);
        assertThat(declaredSilent).as("no silent set declared for %s", record.getSimpleName())
                .isNotNull();

        for (RecordComponent component : record.getRecordComponents()) {
            String name = component.getName();
            FlatmateEditImpact impact = classify.apply(with(record, base, name));
            boolean noticed = !FlatmateEditImpact.SILENT.equals(impact);

            if (declaredSilent.contains(name)) {
                assertThat(noticed).as(
                        "`%s` is declared silent in FlatmateEditRules.SILENT but the classifier "
                                + "reacts to it — remove it from the set", name)
                        .isFalse();
            } else {
                assertThat(noticed).as(
                        "editing `%s` on a published %s goes unnoticed: no moderator sees it and "
                                + "nothing appears on the re-check board. Add a rule for it in "
                                + "FlatmateEditRules, or name it in FlatmateEditRules.SILENT with "
                                + "the reason it is safe", name, record.getSimpleName())
                        .isTrue();
            }
        }
    }

    private static Object with(Class<?> record, Object base, String changing) {
        RecordComponent[] components = record.getRecordComponents();
        Class<?>[] types = new Class<?>[components.length];
        Object[] args = new Object[components.length];
        try {
            for (int i = 0; i < components.length; i++) {
                RecordComponent component = components[i];
                types[i] = component.getType();
                Object current = component.getAccessor().invoke(base);
                args[i] = component.getName().equals(changing)
                        ? other(component, current)
                        : current;
            }
            return record.getDeclaredConstructor(types).newInstance(args);
        } catch (ReflectiveOperationException e) {
            throw new IllegalStateException("could not rebuild " + record.getSimpleName(), e);
        }
    }

    // Must differ *as stored*: societyId is parsed to a UUID and a mobile is normalised to ten
    // digits, so two values that collapse to the same stored value would hide a live classifier.
    private static Object other(RecordComponent component, Object current) {
        String name = component.getName();
        String lower = name.toLowerCase(Locale.ROOT);
        Class<?> type = component.getType();
        if (lower.endsWith("id")) {
            return UUID.randomUUID().toString();
        }
        if (lower.contains("mobile")) {
            return "9800000002";
        }
        if (type == String.class) {
            return "other-" + name;
        }
        if (type == Long.class) {
            return current == null ? 99L : (Long) current + 1;
        }
        if (type == Integer.class) {
            return current == null ? 9 : (Integer) current + 1;
        }
        if (type == Double.class) {
            return current == null ? 9.0 : (Double) current + 1;
        }
        if (type == Boolean.class) {
            return !Boolean.TRUE.equals(current);
        }
        if (type == LocalDate.class) {
            return LocalDate.of(2031, 3, 3);
        }
        if (type == List.class) {
            return List.of("other-" + name);
        }
        if (type == Map.class) {
            return Map.of("other", name);
        }
        throw new IllegalStateException(
                "no distinct value known for " + name + " of type " + type
                        + " — teach `other` about it so the field can be covered");
    }

    private static FlatmateRoomCreateRequest roomRequest() {
        return new FlatmateRoomCreateRequest("Flat", "2", "Private room", "attached", "semi",
                "East", "Garden", "Baner", UUID.randomUUID().toString(), "Alpha Heights", "B-402",
                15000L, 30000L, 2, 3, 30, 6, "included", "separate",
                LocalDate.of(2026, 9, 1), "any", "any",
                List.of("non-smoker"), "tenant", UUID.randomUUID().toString(), true,
                Map.of("url", "https://cdn.example/a.pdf"),
                "PNE-3/1234/2025", LocalDate.of(2025, 10, 1), LocalDate.of(2026, 9, 1),
                "9800000001",
                List.of("https://cdn.example/1.jpg", "https://cdn.example/2.jpg"),
                "Sunny room.", 18.5600, 73.7800);
    }

    private static FlatmateRoom roomMatching(FlatmateRoomCreateRequest in) {
        FlatmateRoom room = new FlatmateRoom();
        room.setBhk(in.bhk());
        room.setHomeTypeLabel(in.homeTypeLabel());
        room.setRoomType(in.roomType());
        room.setFurnishing(in.furnishing());
        room.setFacing(in.facing());
        room.setOverlooking(in.overlooking());
        room.setLocality(in.locality());
        room.setSocietyId(UUID.fromString(in.societyId()));
        room.setSociety(in.society());
        room.setFlatNumber(in.flatNumber());
        room.setBudget(in.rentShare());
        room.setDeposit(in.deposit());
        room.setOccupants(in.occupants());
        room.setMaxOccupants(in.maxOccupants());
        room.setNoticePeriodDays(in.noticePeriodDays());
        room.setLockInMonths(in.lockInMonths());
        room.setMaintenanceBilling(in.maintenanceBilling());
        room.setElectricityBilling(in.electricityBilling());
        room.setAvailableFrom(in.availableFrom());
        room.setTags(new ArrayList<>(in.lifestyle()));
        room.setPhotos(new ArrayList<>(in.photos()));
        room.setNote(in.note());
        room.setLat(in.lat());
        room.setLng(in.lng());
        return room;
    }

    private static FlatmateGroupCreateRequest groupRequest() {
        return new FlatmateGroupCreateRequest("Four of us in Baner", "Baner", "mixed",
                48000L, 96000L, 30, 6, "shared", "separate", 4, 1,
                "Asha", "tenant", UUID.randomUUID().toString(), true,
                Map.of("url", "https://cdn.example/b.pdf"),
                "PNE-3/5678/2025", LocalDate.of(2025, 10, 1), LocalDate.of(2026, 9, 1),
                "9800000001",
                List.of("non-smoker"), "Quiet flat.");
    }

    private static FlatmateGroup groupMatching(FlatmateGroupCreateRequest in) {
        FlatmateGroup group = new FlatmateGroup();
        group.setTitle(in.title());
        group.setLocality(in.locality());
        group.setRent(in.rent());
        group.setDeposit(in.deposit());
        group.setNoticePeriodDays(in.noticePeriodDays());
        group.setLockInMonths(in.lockInMonths());
        group.setMaintenanceBilling(in.maintenanceBilling());
        group.setElectricityBilling(in.electricityBilling());
        group.setSeatsTotal(in.seats());
        group.setTags(new ArrayList<>(in.tags()));
        group.setNote(in.note());
        group.setOwnerConsentMobile(in.consentMobile());
        return group;
    }

    private static FlatmateSeekerPostCreateRequest postRequest() {
        return new FlatmateSeekerPostCreateRequest("Asha", "any", 27, "Designer", 18000L, 24000L,
                List.of("Baner", "Aundh"), "now", "any", "any", List.of("non-smoker"),
                "Looking for a quiet flat.", true);
    }

    private static FlatmateSeekerPost postMatching(FlatmateSeekerPostCreateRequest in) {
        FlatmateSeekerPost post = new FlatmateSeekerPost();
        post.setName(in.name());
        post.setOccupation(in.occupation());
        post.setNote(in.note());
        post.setBudget(in.budget());
        post.setBudgetMax(in.budgetMax());
        post.setLocalities(new ArrayList<>(in.localities()));
        post.setTags(new ArrayList<>(in.tags()));
        post.setMoveIn(in.moveIn());
        return post;
    }
}
