(function ($) {
	"use strict";

	var game = window.numberGameConfiguration;
	var bestTimesStorageKey = "numberGame.bestTimes.v1";
	var soundSettingsStorageKey = "numberGame.soundSettings.v1";
	var defaultBestTime = 10 * 60;
	var bestTimes = loadBestTimes();
	var level;
	var nextNumber = 1;
	var wrongClicksSinceCorrect = 0;
	var startedAt;
	var messageTimer;
	var resizeFrame;
	var paceFrame;
	var lastAudibleVolume = 1;
	var settingsPreviouslyFocused;
	var clickSound = new Audio("sounds/click.mp3");

	clickSound.preload = "auto";

	var $board;
	var $boardStage;
	var $error;
	var $fullscreenButton;
	var $image;
	var $levelSelector;
	var $levelSelect;
	var $map;
	var $next;
	var $paceFill;
	var $pacePosition;
	var $paceTimeline;
	var $result;
	var $search;
	var $settingsButton;
	var $settingsClose;
	var $settingsDialog;
	var $start;
	var $startButton;
	var $volumeIcon;
	var $volumeSlider;
	var $volumeToggle;
	var $volumeValue;

	$(function () {
		$board = $("#img_b");
		$boardStage = $("#board_stage");
		$error = $("#error");
		$fullscreenButton = $("#fullscreen_button");
		$image = $("#img");
		$levelSelector = $(".level-selector");
		$levelSelect = $("#level_select");
		$map = $("#numbers");
		$next = $("#next");
		$paceFill = $("#pace_fill");
		$pacePosition = $("#pace_position");
		$paceTimeline = $("#pace_timeline");
		$result = $("#result");
		$search = $("#search");
		$settingsButton = $("#settings_button");
		$settingsClose = $("#settings_close");
		$settingsDialog = $("#settings_dialog");
		$start = $("#start");
		$startButton = $("#button");
		$volumeIcon = $("#volume_icon");
		$volumeSlider = $("#volume_slider");
		$volumeToggle = $("#volume_toggle");
		$volumeValue = $("#volume_value");

		$startButton.on("click", start);
		$fullscreenButton.on("click", toggleGameFullscreen);
		$settingsButton.on("click", openSettingsDialog);
		$settingsClose.on("click", function () {
			closeSettingsDialog(true);
		});
		$settingsDialog.on("click", function (event) {
			if (event.target === this) {
				closeSettingsDialog(true);
			}
		});
		$("#main_menu_button").on("click", returnToMainPage);
		$("#restart_button").on("click", restartGame);
		$volumeSlider.on("input change", setVolumeFromSlider);
		$volumeToggle.on("click", toggleSound);
		$levelSelect.on("change", function () {
			loadLevel($levelSelect.val());
		});
		$result.on("click", "#button2", start);
		$(document).on(
			"fullscreenchange webkitfullscreenchange",
			syncNativeFullscreenState
		);
		$(window).on("resize orientationchange", scheduleBoardScaleUpdate);
		if (window.visualViewport) {
			$(window.visualViewport).on(
				"resize",
				scheduleBoardScaleUpdate
			);
		}
		$(document).on("keydown", function (event) {
			if (event.which === 27 && !$settingsDialog.prop("hidden")) {
				closeSettingsDialog(true);
				return;
			}

			if (event.which === 17) {
				alert("Feeling clever?");
			}
		});

		loadSoundSettings();
		syncVolumeControls();
		loadLevelManifest();
	});

	function loadLevelManifest() {
		setStartButtonReady(false);

		$.getJSON("levels/index.json")
			.done(function (manifest) {
				try {
					populateLevelSelector(manifest);
					loadLevel($levelSelect.val());
				} catch (error) {
					showLoadError(error.message);
				}
			})
			.fail(function () {
				showLoadError(
					"Could not load levels/index.json. Open the game through a local web server."
				);
			});
	}

	function populateLevelSelector(manifest) {
		if (
			!manifest ||
			!Array.isArray(manifest.levels) ||
			manifest.levels.length === 0 ||
			manifest.levels.some(function (file) {
				return typeof file !== "string" || !file;
			})
		) {
			throw new Error("Level manifest is invalid.");
		}

		$levelSelect.empty();
		manifest.levels.forEach(function (file, index) {
			$("<option>", {
				value: file,
				text: "Level " + (index + 1)
			}).appendTo($levelSelect);
		});

		if (manifest.levels.indexOf(game.defaultLevel) !== -1) {
			$levelSelect.val(game.defaultLevel);
		}

		$levelSelect.prop("disabled", false);
	}

	function loadLevel(file) {
		var path = "levels/" + file;

		resetForLevelLoad();
		setStartButtonReady(false);
		$levelSelect.prop("disabled", true);

		$.getJSON(path)
			.done(function (configuration) {
				try {
					validateLevel(configuration);
					level = configuration;
					buildLevel();
					setStartButtonReady(true);
				} catch (error) {
					showLoadError(error.message);
				}
			})
			.fail(function () {
				showLoadError(
					"Could not load " +
						path +
						". Open the game through a local web server."
				);
			})
			.always(function () {
				$levelSelect.prop("disabled", false);
			});
	}

	function resetForLevelLoad() {
		window.clearTimeout(messageTimer);
		stopPaceTimeline();
		removeMapHighlight();
		level = null;
		nextNumber = 1;
		wrongClicksSinceCorrect = 0;
		startedAt = null;
		hideMessage();
		$boardStage.hide();
		$search.hide();
		$result.empty().hide();
		$start.show();
		$levelSelector.show();
		$("body").removeClass("is-playing is-timing");
		$board.children(".number-field").remove();
		$map.empty();
		$("#config_error").empty().hide();
		$("#game_instruction").text("Loading level…");
	}

	function removeMapHighlight() {
		var $wrapper;

		if (!$image.hasClass("maphilighted")) {
			return;
		}

		$wrapper = $image.parent();
		$image.insertBefore($wrapper);
		$wrapper.remove();
		$map.off(".maphilight");
		$image.removeClass("maphilighted").removeAttr("style");
	}

	function validateLevel(configuration) {
		if (!configuration || typeof configuration !== "object") {
			throw new Error("Level configuration must be an object.");
		}

		if (
			!Array.isArray(configuration.fields) ||
			configuration.fields.length !== configuration.numberFieldCount
		) {
			throw new Error("numberFieldCount must match the fields array.");
		}

		configuration.fields.forEach(function (field, index) {
			var coordinates = field.area && field.area.coordinates;
			var label = field.label;
			var font = label && label.font;

			if (
				!field.area ||
				!Array.isArray(coordinates) ||
				coordinates.length < 6 ||
				coordinates.length % 2 !== 0 ||
				coordinates.some(function (coordinate) {
					return !Number.isFinite(coordinate);
				})
			) {
				throw new Error("Field " + index + " has an invalid clickable area.");
			}

			if (
				!label ||
				!font ||
				!Number.isFinite(label.left) ||
				!Number.isFinite(label.top) ||
				!Number.isFinite(label.width) ||
				!Number.isFinite(font.size)
			) {
				throw new Error("Field " + index + " has an invalid font configuration.");
			}
		});
	}

	function buildLevel() {
		document.title = game.name;
		$("#game_logo").attr("alt", game.name);
		$("#game_instruction").text(
			"Find all numbers in order from 1 to " + level.numberFieldCount
		);
		$board.css({
			width: game.width + "px",
			height: game.height + "px",
			backgroundImage: 'url("' + level.backgroundImage + '")',
			marginLeft: -game.width / 2 + "px"
		});
		setBoardScale(game.displayScale);

		$image.attr({
			src: game.fieldImage,
			width: game.width,
			height: game.height
		});

		$board.children(".number-field").remove();
		$map.empty();

		level.fields.forEach(function (field, index) {
			var font = field.label.font;
			var $label = $("<span>", {
				id: "n_" + index,
				"class": "number-field",
				"aria-hidden": "true"
			}).css({
				left: field.label.left + "px",
				top: field.label.top + "px",
				width: field.label.width + "px",
				transform: field.label.transform,
				fontSize: font.size + "px",
				fontWeight: font.weight,
				color: font.color
			});

			var $area = $("<area>", {
				id: "f_" + index,
				shape: "poly",
				coords: field.area.coordinates.join(","),
				alt: "Number field " + (index + 1)
			}).on("click.game", function (event) {
				event.preventDefault();
				checkNumber($(this).data("number"));
			});

			$label.insertBefore($image);
			$map.append($area);
		});
	}

	function setStartButtonReady(isReady) {
		$startButton
			.toggleClass("is-disabled", !isReady)
			.attr("aria-disabled", String(!isReady))
			.text(isReady ? "Start" : "Loading…");
	}

	function showLoadError(message) {
		$("#config_error").text(message).show();
		$startButton
			.addClass("is-disabled")
			.attr("aria-disabled", "true")
			.text("Load error");
	}

	function start(event) {
		if (event) {
			event.preventDefault();
		}

		if (!level) {
			return;
		}

		window.clearTimeout(messageTimer);
		stopPaceTimeline();
		hideMessage();
		closeSettingsDialog(false);
		startedAt = null;
		nextNumber = 1;
		wrongClicksSinceCorrect = 0;

		$start.hide();
		$levelSelector.hide();
		$result.hide();
		$("body").removeClass("is-timing").addClass("is-playing");
		$search.show();
		$boardStage.show();
		$next.text(nextNumber);
		updateBoardScale();

		$image.maphilight({ stroke: false, fillOpacity: 0 });

		createNumbers(level.numberFieldCount).forEach(function (number, index) {
			var field = level.fields[index];
			setLabelNumber(index, field, number);
			$("#f_" + index).data("number", number);
		});
		scheduleBoardScaleUpdate();
	}

	function returnToMainPage() {
		window.clearTimeout(messageTimer);
		stopPaceTimeline();
		closeSettingsDialog(false);
		startedAt = null;
		nextNumber = 1;
		wrongClicksSinceCorrect = 0;
		hideMessage();
		$boardStage.hide();
		$search.hide();
		$result.empty().hide();
		$levelSelector.show();
		$start.show();
		$("body").removeClass("is-playing is-timing");
	}

	function startTiming() {
		startedAt = new Date();
		$("body").addClass("is-timing");
		startPaceTimeline();
	}

	function openSettingsDialog() {
		if (!$("body").hasClass("is-playing")) {
			return;
		}

		settingsPreviouslyFocused = document.activeElement;
		$settingsDialog.prop("hidden", false);
		$settingsButton.attr("aria-expanded", "true");
		$settingsClose.trigger("focus");
	}

	function closeSettingsDialog(restoreFocus) {
		if (!$settingsDialog || $settingsDialog.prop("hidden")) {
			return;
		}

		$settingsDialog.prop("hidden", true);
		$settingsButton.attr("aria-expanded", "false");

		if (
			restoreFocus &&
			settingsPreviouslyFocused &&
			document.body.contains(settingsPreviouslyFocused)
		) {
			settingsPreviouslyFocused.focus();
		}
	}

	function restartGame() {
		closeSettingsDialog(false);
		start();
	}

	function setVolumeFromSlider() {
		var volume = Number($volumeSlider.val()) / 100;

		clickSound.volume = volume;
		clickSound.muted = volume === 0;

		if (volume > 0) {
			lastAudibleVolume = volume;
		}

		syncVolumeControls();
		saveSoundSettings();
	}

	function toggleSound() {
		if (!clickSound.muted && clickSound.volume > 0) {
			lastAudibleVolume = clickSound.volume;
			clickSound.muted = true;
		} else {
			if (clickSound.volume === 0) {
				clickSound.volume = lastAudibleVolume;
				$volumeSlider.val(Math.round(lastAudibleVolume * 100));
			}

			clickSound.muted = false;
		}

		syncVolumeControls();
		saveSoundSettings();
	}

	function loadSoundSettings() {
		try {
			var settings = JSON.parse(
				window.localStorage.getItem(soundSettingsStorageKey) || "null"
			);
			var volume = settings && Number(settings.volume);
			var previousVolume = settings && Number(settings.lastAudibleVolume);

			if (Number.isFinite(volume) && volume >= 0 && volume <= 100) {
				clickSound.volume = volume / 100;
			}

			if (settings && typeof settings.muted === "boolean") {
				clickSound.muted = settings.muted;
			}

			if (
				Number.isFinite(previousVolume) &&
				previousVolume > 0 &&
				previousVolume <= 100
			) {
				lastAudibleVolume = previousVolume / 100;
			} else if (clickSound.volume > 0) {
				lastAudibleVolume = clickSound.volume;
			}
		} catch (error) {
			// Keep the default sound settings when storage is unavailable.
		}
	}

	function saveSoundSettings() {
		try {
			window.localStorage.setItem(
				soundSettingsStorageKey,
				JSON.stringify({
					volume: Math.round(clickSound.volume * 100),
					muted: clickSound.muted,
					lastAudibleVolume: Math.round(lastAudibleVolume * 100)
				})
			);
		} catch (error) {
			// Keep the settings in memory when storage is unavailable.
		}
	}

	function syncVolumeControls() {
		var volumePercent = Math.round(clickSound.volume * 100);
		var isAudible = !clickSound.muted && volumePercent > 0;
		var actionLabel = isAudible ? "Mute sound" : "Unmute sound";

		$volumeSlider.val(volumePercent);
		$volumeValue.text(volumePercent + "%");
		$volumeIcon
			.toggleClass("bi-volume-up-fill", isAudible)
			.toggleClass("bi-volume-mute-fill", !isAudible);
		$volumeToggle
			.attr("aria-label", actionLabel)
			.attr("title", actionLabel)
			.attr("aria-pressed", String(!isAudible));
	}

	function scheduleBoardScaleUpdate() {
		window.cancelAnimationFrame(resizeFrame);
		resizeFrame = window.requestAnimationFrame(updateBoardScale);
	}

	function updateBoardScale() {
		var gameElement;
		var gameStyle;
		var boardRect;
		var viewport;
		var viewportWidth;
		var viewportBottom;
		var horizontalPadding;
		var verticalPadding;
		var bottomPadding;
		var availableWidth;
		var availableHeight;
		var scale;
		var isImmersiveMode;

		if (!$boardStage || !$boardStage.is(":visible")) {
			return;
		}

		gameElement = document.querySelector(".game");
		gameStyle = window.getComputedStyle(gameElement);
		boardRect = $boardStage[0].getBoundingClientRect();
		viewport = window.visualViewport;
		viewportWidth = viewport ? viewport.width : window.innerWidth;
		viewportBottom = viewport
			? viewport.offsetTop + viewport.height
			: window.innerHeight;
		horizontalPadding =
			parseFloat(gameStyle.paddingLeft) +
			parseFloat(gameStyle.paddingRight);
		verticalPadding =
			parseFloat(gameStyle.paddingTop) +
			parseFloat(gameStyle.paddingBottom);
		bottomPadding = parseFloat(gameStyle.paddingBottom);
		isImmersiveMode =
			$("body").hasClass("is-game-fullscreen") ||
			(window.matchMedia &&
				window.matchMedia(
					"(orientation: landscape) and (max-height: 500px)"
				).matches);
		availableWidth = Math.min(
			gameElement.clientWidth - horizontalPadding,
			viewportWidth - horizontalPadding
		);

		if (isImmersiveMode) {
			availableHeight =
				(viewport ? viewport.height : window.innerHeight) -
				verticalPadding;
			scale = Math.min(
				availableWidth / game.width,
				availableHeight / game.height
			);
		} else {
			availableHeight = viewportBottom - boardRect.top - bottomPadding;
			scale = Math.min(
				game.displayScale,
				availableWidth / game.width,
				availableHeight / game.height
			);
		}

		setBoardScale(Math.max(0.1, Math.floor(scale * 1000) / 1000));
	}

	function setBoardScale(scale) {
		$boardStage.css({
			width: game.width * scale + "px",
			height: game.height * scale + "px"
		});
		$board.css({
			transform: "scale(" + scale + ")"
		});
	}

	function loadBestTimes() {
		try {
			var stored = JSON.parse(
				window.localStorage.getItem(bestTimesStorageKey) || "{}"
			);

			if (stored && typeof stored === "object" && !Array.isArray(stored)) {
				return stored;
			}
		} catch (error) {
			// Continue without persisted results when storage is unavailable.
		}

		return {};
	}

	function getBestTime(levelFile) {
		var bestTime = Number(bestTimes[levelFile]);

		return Number.isFinite(bestTime) && bestTime > 0 ? bestTime : null;
	}

	function rememberBestTime(levelFile, seconds) {
		var previousBest = getBestTime(levelFile);
		var isNewBest = previousBest === null || seconds < previousBest;

		if (isNewBest) {
			bestTimes[levelFile] = seconds;

			try {
				window.localStorage.setItem(
					bestTimesStorageKey,
					JSON.stringify(bestTimes)
				);
			} catch (error) {
				// Keep the result in memory if persistent storage is unavailable.
			}
		}

		return {
			bestTime: isNewBest ? seconds : previousBest,
			isNewBest: isNewBest
		};
	}

	function startPaceTimeline() {
		stopPaceTimeline();
		updatePaceTimeline();
	}

	function stopPaceTimeline() {
		window.cancelAnimationFrame(paceFrame);
		paceFrame = null;
	}

	function calculatePacePercent(projectedTime, bestTime) {
		var ratio = projectedTime / bestTime;
		var percent;

		if (ratio <= 1) {
			percent = 66 / Math.max(ratio, 0.0001);
		} else if (ratio <= 1.5) {
			percent = 66 - ((ratio - 1) / 0.5) * 16;
		} else if (ratio <= 2) {
			percent = 50 - ((ratio - 1.5) / 0.5) * 17;
		} else {
			percent = 33 - (ratio - 2) * 33;
		}

		return Math.max(0, Math.min(100, percent));
	}

	function updatePaceTimeline() {
		var bestTime = getBestTime($levelSelect.val()) || defaultBestTime;
		var pacePercent = 100;
		var color = "#35c759";
		var valueText = "100% projected pace score.";

		if (startedAt && level) {
			var elapsedSeconds = (Date.now() - startedAt) / 1000;
			var projectedTime =
				(elapsedSeconds / Math.max(1, nextNumber)) *
				level.numberFieldCount;

			pacePercent = calculatePacePercent(projectedTime, bestTime);

			if (pacePercent <= 33) {
				color = "#ef4444";
			} else if (pacePercent <= 50) {
				color = "#f59e0b";
			} else if (pacePercent <= 66) {
				color = "#f7d570";
			}

			valueText =
				Math.round(pacePercent) + "% projected pace score.";
		}

		$paceFill.css({
			width: pacePercent + "%",
			backgroundColor: color
		});
		$pacePosition.css({
			left: pacePercent + "%",
			backgroundColor: color
		});
		$paceTimeline
			.attr("aria-valuenow", Math.round(pacePercent))
			.attr("aria-valuetext", valueText);

		paceFrame = window.requestAnimationFrame(updatePaceTimeline);
	}

	function formatDuration(seconds) {
		if (seconds < 60) {
			return seconds.toFixed(1) + " sec";
		}

		return (seconds / 60).toFixed(1) + " min";
	}

	function setGameFullscreenMode(isFullscreen) {
		$("body").toggleClass("is-game-fullscreen", isFullscreen);
		$fullscreenButton
			.attr(
				"aria-label",
				isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
			)
			.attr(
				"title",
				isFullscreen ? "Exit fullscreen" : "Enter fullscreen"
			);
		scheduleBoardScaleUpdate();
	}

	function getFullscreenElement() {
		return document.fullscreenElement || document.webkitFullscreenElement;
	}

	function toggleGameFullscreen() {
		if ($("body").hasClass("is-game-fullscreen")) {
			leaveGameFullscreen();
			return;
		}

		setGameFullscreenMode(true);

		var root = document.documentElement;
		var requestFullscreen =
			root.requestFullscreen || root.webkitRequestFullscreen;

		if (requestFullscreen) {
			var request = requestFullscreen.call(root);

			if (request && request.catch) {
				request.catch(function () {
					// Keep the CSS fullscreen fallback on browsers without element fullscreen.
				});
			}
		}
	}

	function leaveGameFullscreen() {
		var exitFullscreen =
			document.exitFullscreen || document.webkitExitFullscreen;

		setGameFullscreenMode(false);

		if (getFullscreenElement() && exitFullscreen) {
			var exit = exitFullscreen.call(document);

			if (exit && exit.catch) {
				exit.catch(function () {});
			}
		}
	}

	function syncNativeFullscreenState() {
		if (!getFullscreenElement()) {
			setGameFullscreenMode(false);
		}
	}

	function createNumbers(count) {
		var numbers = [];
		var number;

		for (number = 1; number <= count; number += 1) {
			numbers.push(number);
		}

		shuffle(numbers);
		shuffle(numbers);
		shuffle(numbers);

		return numbers;
	}

	function shuffle(numbers) {
		var index;

		for (index = numbers.length - 1; index > 0; index -= 1) {
			var randomIndex = Math.floor(Math.random() * (index + 1));
			var temporary = numbers[randomIndex];
			numbers[randomIndex] = numbers[index];
			numbers[index] = temporary;
		}

		return numbers;
	}

	function setLabelNumber(index, field, number) {
		var text = String(number);
		var firstCharacter = field.label.font.firstCharacter;
		var $label = $("#n_" + index).empty();

		if (!firstCharacter) {
			$label.text(text);
			return;
		}

		$("<span>")
			.text(text.charAt(0))
			.css({
				fontSize: firstCharacter.size
					? firstCharacter.size + "px"
					: "inherit",
				fontWeight: firstCharacter.weight || "inherit",
				color: firstCharacter.color || "inherit"
			})
			.appendTo($label);

		$label.append(document.createTextNode(text.slice(1)));
	}

	function showMessage(message, duration) {
		window.clearTimeout(messageTimer);
		$error.html(message).addClass("is-visible");
		messageTimer = window.setTimeout(hideMessage, duration);
	}

	function hideMessage() {
		$error.empty().removeClass("is-visible");
	}

	function playClickSound() {
		clickSound.currentTime = 0;
		var playback = clickSound.play();

		if (playback) {
			playback.catch(function () {
				// Some browsers can block audio despite a direct tap.
			});
		}
	}

	function checkNumber(number) {
		if (nextNumber !== number) {
			wrongClicksSinceCorrect += 1;

			if (wrongClicksSinceCorrect === 1) {
				return;
			}

			showMessage("Wrong number!", 1000);
			return;
		}

		wrongClicksSinceCorrect = 0;
		window.clearTimeout(messageTimer);
		hideMessage();
		playClickSound();

		if (nextNumber === 1) {
			startTiming();
		}

		if (nextNumber === level.numberFieldCount) {
			end();
			return;
		}

		nextNumber += 1;
		$next.text(nextNumber);
	}

	function end() {
		var seconds = (Date.now() - startedAt) / 1000;
		var bestResult = rememberBestTime($levelSelect.val(), seconds);

		window.clearTimeout(messageTimer);
		stopPaceTimeline();
		closeSettingsDialog(false);
		hideMessage();
		$boardStage.hide();
		$search.hide();
		$levelSelector.show();
		$("body").removeClass("is-playing is-timing");
		$result
			.html(
				"You completed the game in " +
					formatDuration(seconds) +
					".<br>" +
					(bestResult.isNewBest ? "New best time: " : "Best time: ") +
					formatDuration(bestResult.bestTime) +
					'.<p class="button"><a href="#" class="action-button shadow animate blue game-button" id="button2">Play Again</a></p>'
			)
			.show();
	}
})(jQuery);
