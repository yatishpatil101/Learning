package com.draazy.api.catalog.photo;

import com.draazy.api.common.web.Routes;
import com.draazy.api.security.AuthPrincipal;
import com.draazy.api.security.CurrentUser;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * Listing photo upload at {@code POST /me/photos}.
 *
 * <p>No role guard, for the same reason as {@link com.draazy.api.documents.vault.MeDocumentsController}:
 * any signed-in user becomes an owner the moment they post a listing, so authentication is the gate
 * and there is nothing to owner-scope — the photo is not attached to a property here, only stored
 * and returned as a URL.
 *
 * <p>{@code consumes} is pinned to {@code multipart/form-data} so a JSON body is refused as a 415 by
 * Spring before any of our code runs, matching the answer {@link PhotoUploads} gives for the wrong
 * <em>file</em> type.
 */
@RestController
public class MePhotosController {

    private final PhotoService photoService;

    public MePhotosController(PhotoService photoService) {
        this.photoService = photoService;
    }

    /** {@code POST /me/photos} — multipart upload of one listing photo to the public bucket. */
    @PostMapping(value = Routes.MePhotos.BASE, consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public PhotoDto uploadPhoto(@CurrentUser AuthPrincipal principal,
            @RequestParam("file") MultipartFile file) {
        return photoService.upload(principal.userId(), file);
    }
}
