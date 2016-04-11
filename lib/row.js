'use strict';

// Copyright 2016 Yahoo Inc.
// Licensed under the terms of the MIT license. Please see LICENSE file in the project root for terms.

var merge = require('merge');

/**
* Row
* Wrapper for each row in a justified layout.
* Stores relevant values and provides methods for calculating layout of individual rows.
*
* @param {Object} layoutConfig - The same as that passed
* @param {Object} Initialization paramters. The following are all required:
* @param params.top {Number} Top of row, relative to container
* @param params.left {Number} Left side of row relative to container (equal to container left padding)
* @param params.width {Number} Width of row, not including container padding
* @param params.spacing {Number} Horizontal spacing between items
* @param params.targetRowHeight {Number} Layout algorithm will aim for this row height
* @param params.targetRowHeightTolerance {Number} Row heights may vary +/- (`targetRowHeight` x `targetRowHeightTolerance`)
* @param params.edgeCaseMinRowHeight {Number} Absolute minimum row height for edge cases that cannot be resolved within tolerance.
* @param params.edgeCaseMaxRowHeight {Number} Absolute maximum row height for edge cases that cannot be resolved within tolerance.
* @param params.isBreakoutRow {Boolean} Is this row in particular one of those breakout rows? Always false if it's not that kind of photo list
* @constructor
*/
var Row = module.exports = function (params) {

	// Top of row, relative to container
	this.top = params.top;

	// Left side of row relative to container (equal to container left padding)
	this.left = params.left;

	// Width of row, not including container padding
	this.width = params.width;

	// Horizontal spacing between items
	this.spacing = params.spacing;

	// Row height calculation values
	this.targetRowHeight = params.targetRowHeight;
	this.targetRowHeightTolerance = params.targetRowHeightTolerance;
	this.minAspectRatio = this.width / params.targetRowHeight * (1 - params.targetRowHeightTolerance);
	this.maxAspectRatio = this.width / params.targetRowHeight * (1 + params.targetRowHeightTolerance);

	// Edge case row height minimum/maximum
	this.edgeCaseMinRowHeight = params.edgeCaseMinRowHeight;
	this.edgeCaseMaxRowHeight = params.edgeCaseMaxRowHeight;

	// Layout direction
	this.rightToLeft = params.rightToLeft;

	// Full width breakout rows
	this.isBreakoutRow = params.isBreakoutRow;

	// Store layout data for each item in row
	this.items = [];

	// Height remains at 0 until it's been calculated
	this.height = 0;
};

Row.prototype = {

	/**
 * Attempt to add a single item to the row.
 * This is the heart of the justified algorithm.
 * This method is direction-agnostic; it deals only with sizes, not positions.
 *
 * If the item fits in the row, without pushing row height beyond min/max tolerance,
 * the item is added and the method returns true.
 *
 * If the item leaves row height too high, there may be room to scale it down and add another item.
 * In this case, the item is added and the method returns true, but the row is incomplete.
 *
 * If the item leaves row height too short, there are too many items to fit within tolerance.
 * The method will either accept or reject the new item, favoring the resulting row height closest to within tolerance.
 * If the item is rejected, left/right padding will be required to fit the row height within tolerance;
 * if the item is accepted, top/bottom cropping will be required to fit the row height within tolerance.
 *
 * @method addItem
 * @param itemData {Object} Item layout data, containing item aspect ratio.
 * @return {Boolean} True if successfully added; false if rejected.
 */
	addItem: function addItem(itemData) {

		var newItems = this.items.concat(itemData),

		// Calculate aspect ratios for items only; exclude spacing
		rowWidthWithoutSpacing = this.width - (newItems.length - 1) * this.spacing,
		    newAspectRatio = newItems.reduce(function (sum, item) {
			return sum + item.aspectRatio;
		}, 0),
		    targetAspectRatio = rowWidthWithoutSpacing / this.targetRowHeight,
		    previousRowWidthWithoutSpacing,
		    previousAspectRatio,
		    previousTargetAspectRatio;

		// Handle big full-width breakout photos if we're doing them
		if (this.isBreakoutRow) {
			// Only do it if there's no other items in this row
			if (this.items.length === 0) {
				// Only go full width if this photo is a square or landscape
				if (itemData.aspectRatio >= 1) {
					// Close out the row with a full width photo
					this.items.push(itemData);
					this.completeLayout(rowWidthWithoutSpacing / itemData.aspectRatio);
					return true;
				}
			}
		}

		if (newAspectRatio < this.minAspectRatio) {

			// New aspect ratio is too narrow / scaled row height is too tall.
			// Accept this item and leave row open for more items.

			this.items.push(merge(itemData));
			return true;
		} else if (newAspectRatio > this.maxAspectRatio) {

			// New aspect ratio is too wide / scaled row height will be too short.
			// Accept item if the resulting aspect ratio is closer to target than it would be without the item.
			// NOTE: Any row that falls into this block will require cropping/padding on individual items.

			if (this.items.length === 0) {

				// When there are no existing items, force acceptance of the new item and complete the layout.
				// This is the pano special case.
				this.items.push(merge(itemData));
				this.completeLayout(rowWidthWithoutSpacing / newAspectRatio);
				return true;
			}

			// Calculate width/aspect ratio for row before adding new item
			previousRowWidthWithoutSpacing = this.width - (this.items.length - 1) * this.spacing;
			previousAspectRatio = this.items.reduce(function (sum, item) {
				return sum + item.aspectRatio;
			}, 0);
			previousTargetAspectRatio = previousRowWidthWithoutSpacing / this.targetRowHeight;

			if (Math.abs(newAspectRatio - targetAspectRatio) > Math.abs(previousAspectRatio - previousTargetAspectRatio)) {

				// Row with new item is us farther away from target than row without; complete layout and reject item.
				this.completeLayout(previousRowWidthWithoutSpacing / previousAspectRatio);
				return false;
			} else {

				// Row with new item is us closer to target than row without;
				// accept the new item and complete the row layout.
				this.items.push(merge(itemData));
				this.completeLayout(rowWidthWithoutSpacing / newAspectRatio);
				return true;
			}
		} else {

			// New aspect ratio / scaled row height is within tolerance;
			// accept the new item and complete the row layout.
			this.items.push(merge(itemData));
			this.completeLayout(rowWidthWithoutSpacing / newAspectRatio);
			return true;
		}
	},

	/**
 * Check if a row has completed its layout.
 *
 * @method isLayoutComplete
 * @return {Boolean} True if complete; false if not.
 */
	isLayoutComplete: function isLayoutComplete() {
		return this.height > 0;
	},

	/**
 * Set row height and compute item geometry from that height.
 * Will justify items within the row unless instructed not to.
 *
 * @method completeLayout
 * @param newHeight {Number} Set row height to this value.
 * @param justify Apply error correction to ensure photos exactly fill the row. Defaults to `true`.
 */
	completeLayout: function completeLayout(newHeight, justify) {

		var itemWidthSum = this.left,
		    rowWidthWithoutSpacing = this.width - (this.items.length - 1) * this.spacing,
		    clampedToNativeRatio,
		    roundedHeight,
		    clampedHeight,
		    errorWidthPerItem,
		    roundedCumulativeErrors,
		    singleItemGeometry,
		    self = this;

		// Justify unless explicitly specified otherwise.
		if (typeof justify === 'undefined') {
			justify = true;
		}

		// Don't set fractional values in the layout.
		roundedHeight = Math.round(newHeight);

		// Clamp row height to edge case minimum/maximum.
		clampedHeight = Math.max(this.edgeCaseMinRowHeight, Math.min(roundedHeight, this.edgeCaseMaxRowHeight));

		if (roundedHeight !== clampedHeight) {

			// If row height was clamped, the resulting row/item aspect ratio will be off,
			// so force it to fit the width (recalculate aspectRatio to match clamped height).
			// NOTE: this will result in cropping/padding commensurate to the amount of clamping.
			this.height = clampedHeight;
			clampedToNativeRatio = rowWidthWithoutSpacing / clampedHeight / (rowWidthWithoutSpacing / roundedHeight);
		} else {

			// If not clamped, leave ratio at 1.0.
			this.height = roundedHeight;
			clampedToNativeRatio = 1.0;
		}

		// Compute item geometry based on newHeight.
		this.items.forEach(function (item, i) {

			item.top = self.top;
			item.width = Math.round(item.aspectRatio * self.height * clampedToNativeRatio);
			item.height = self.height;

			// Left-to-right.
			// TODO right to left
			// item.left = self.width - itemWidthSum - item.width;
			item.left = itemWidthSum;

			// Incrememnt width.
			itemWidthSum += item.width + self.spacing;
		});

		// If specified, ensure items fill row and distribute error
		// caused by rounding width and height across all items.
		if (justify) {

			// TODO Right to left
			// Left-to-right increments itemWidthSum differently;
			// account for that before distributing error.
			// if (!this.rightToLeft) {
			itemWidthSum -= this.spacing + this.left;

			errorWidthPerItem = (itemWidthSum - this.width) / this.items.length;
			roundedCumulativeErrors = this.items.map(function (item, i) {
				return Math.round((i + 1) * errorWidthPerItem);
			});

			if (this.items.length === 1) {

				// For rows with only one item, adjust item width to fill row.
				singleItemGeometry = this.items[0];
				singleItemGeometry.width -= Math.round(errorWidthPerItem);

				// In right-to-left layouts, shift item to account for width change.
				// TODO Right to left
				// if (this.rightToLeft) {
				// 	singleItemGeometry.left += Math.round(errorWidthPerItem);
				// }
			} else {

					// For rows with multiple items, adjust item width and shift items to fill the row,
					// while maintaining equal spacing between items in the row.
					this.items.forEach(function (item, i) {
						if (i > 0) {
							item.left -= roundedCumulativeErrors[i - 1];
							item.width -= roundedCumulativeErrors[i] - roundedCumulativeErrors[i - 1];
						} else {
							item.width -= roundedCumulativeErrors[i];
						}
					});
				}
		}
	},

	/**
 * Force completion of row layout with current items.
 *
 * @method forceComplete
 * @param fitToWidth {Boolean} Stretch current items to fill the row width.
 *                             This will likely result in padding.
 * @param fitToWidth {Number}
 */
	forceComplete: function forceComplete(fitToWidth, rowHeight) {

		var rowWidthWithoutSpacing = this.width - (this.items.length - 1) * this.spacing,
		    currentAspectRatio = this.items.reduce(function (sum, item) {
			return sum + item.aspectRatio;
		}, 0);

		// TODO Handle fitting to width

		if (typeof rowHeight === 'number') {

			this.completeLayout(rowHeight, false);
		} else {

			// Complete using target row height.
			this.completeLayout(this.targetRowHeight, false);
		}
	},

	/**
 * Return layout data for items within row.
 * Note: returns actual list, not a copy.
 *
 * @method getItems
 * @return Layout data for items within row.
 */
	getItems: function getItems() {
		return this.items;
	}

};